const { getCombatInfo, GuardRequest } = require("./overlord_tasks_guard")
const { isStronghold, constructSourceKeeperRoomInfra, getSourceKeeperRoomInfraPlan } = require("./room_manager_SK_mining")
const { getBuilderModel } = require("./room_manager_spawn")
const { getRoomMemory } = require("./util")

const MAX_DISTANCE = 140

const HAULER_RATIO = 0.4

const RESERVATION_TICK_THRESHOLD = 1000

Room.prototype.manageRemotes = function () {
    const activeRemotes = this.getActiveRemotes()

    if (this.memory.activeSK.length > 0) {
        for (const sourceKeeperRoomName of this.memory.activeSK) {
            activeRemotes.push(this.getSourceKeeperRoomInfo(sourceKeeperRoomName))
        }
    }

    const invaderStrengthThreshold = getInvaderStrengthThreshold(this.controller.level) // 1에서 100, 8에서 1644정도

    const remotesToSpawn = []

    const canReserve = this.energyCapacityAvailable >= 650

    let remoteNameToConstruct = undefined

    let constructionComplete = true
    outer:
    for (const info of activeRemotes) {
        const targetRoomName = info.remoteName

        const isSoucrKeeperRoom = info.isSoucrKeeperRoom

        if (isSoucrKeeperRoom) {
            if (isStronghold(targetRoomName)) {
                continue
            }
        }

        const memory = getRoomMemory(targetRoomName)

        const status = isSoucrKeeperRoom ? this.getSourceKeeperMiningInfo(targetRoomName) : this.getRemoteStatus(targetRoomName)

        if (!status) {
            continue
        }

        if (!status.constructionComplete) {
            constructionComplete = false
        }

        if (status.block) {
            Game.map.visual.text(`⛔`, new RoomPosition(49, 5, targetRoomName), { fontSize: 5, align: 'right' })
            continue
        }

        const intermediates = status.intermediates

        if (intermediates) {
            for (const intermediateName of intermediates) {
                const intermediateStatus = this.getRemoteStatus(intermediateName)
                if (intermediateStatus.block) {
                    Game.map.visual.text(`⛔`, new RoomPosition(49, 5, targetRoomName), { fontSize: 5, align: 'right' })
                    continue outer
                }
            }
        }

        const targetRoom = Game.rooms[targetRoomName]

        if (targetRoom) {
            const invaders = [...targetRoom.findHostileCreeps()].filter(creep => creep.owner.username !== 'Source Keeper')
            const enemyInfo = getCombatInfo(invaders)
            const isEnemy = invaders.some(creep => creep.checkBodyParts(INVADER_BODY_PARTS))
            const invaderCore = targetRoom.find(FIND_HOSTILE_STRUCTURES).find(structure => structure.structureType === STRUCTURE_INVADER_CORE)

            if (!memory.invader && isEnemy) {
                if (enemyInfo.strength <= invaderStrengthThreshold) {
                    const request = new GuardRequest(this, targetRoomName, enemyInfo)
                    Overlord.registerTask(request)
                }
                memory.invader = true
            } else if (memory.invader && !isEnemy) {
                memory.invader = false
            }

            if (!memory.isCombatant && enemyInfo.strength > 0) {
                const maxTicksToLive = Math.max(...invaders.map(creep => creep.ticksToLive))
                memory.combatantsTicksToLive = Game.time + maxTicksToLive
                memory.isCombatant = true
            } else if (memory.isCombatant && enemyInfo.strength === 0) {
                memory.isCombatant = false
                delete memory.combatantsTicksToLive
            }

            if (!isSoucrKeeperRoom) {
                if (!memory.invaderCore && invaderCore) {
                    memory.invaderCore = true
                } else if (memory.invaderCore && !invaderCore) {
                    memory.invaderCore = false
                }
            }
        }

        if (memory.isCombatant) {
            const leftTicks = memory.combatantsTicksToLive - Game.time
            Game.map.visual.text(`👿${leftTicks}`, new RoomPosition(49, 5, targetRoomName), { fontSize: 5, align: 'right' })
            if (leftTicks <= 0) {
                delete memory.isCombatant
                delete memory.invader
                delete memory.combatantsTicksToLive
            }
            continue
        }

        remotesToSpawn.push(info)

        if (canReserve && !remoteNameToConstruct && (!status.constructionComplete || Game.time > (status.constructionCompleteTime + 3000))) {
            remoteNameToConstruct = targetRoomName
        }
    }

    this.constructRemote(remoteNameToConstruct, constructionComplete)
    this.spawnRemoteWorkers(remotesToSpawn, constructionComplete)
    this.manageRemoteHaulers()
}

Room.prototype.manageRemoteHaulers = function () {
    this.heap.numIdlingRemoteHaulerCarryParts = 0

    const remoteInfos = this.memory.remotes

    if (!remoteInfos) {
        return
    }

    const sourceStats = {}

    outer:
    for (const remoteName in remoteInfos) {
        const info = remoteInfos[remoteName]
        const sourceStat = info.sourceStat
        const intermediates = info.intermediates
        if (!sourceStat) {
            continue
        }
        for (const sourceId in sourceStat) {
            const source = Game.getObjectById(sourceId)
            if (!source) {
                continue outer
            }
            const stat = sourceStat[sourceId]
            sourceStats[sourceId] = {
                sourceId: sourceId,
                roomName: remoteName,
                energyAmountNear: source.energyAmountNear,
                energy: source.energy,
                regeneration: source.ticksToRegeneration || 0,
                pathLength: stat.pathLength,
                work: stat.work,
                intermediates,
            }
        }
    }

    const haulers = Overlord.getCreepsByRole(this.name, 'remoteHauler').filter(creep => {
        if (creep.spawning) {
            return false
        }
        if (creep.memory.getRecycled) {
            return false
        }
        return true
    })

    const freeHaulers = []

    for (const hauler of haulers) {
        if (hauler.memory.targetRoomName) {
            runRemoteHauler(hauler, this, hauler.memory.targetRoomName)
            if (!hauler.memory.supplying && hauler.memory.sourceId && sourceStats[hauler.memory.sourceId]) {
                sourceStats[hauler.memory.sourceId].energyAmountNear -= hauler.store.getCapacity()
            }
        }
        if (!hauler.memory.targetRoomName) {
            freeHaulers.push(hauler)
        }
    }

    if (!freeHaulers.length === 0) {
        return
    }

    for (const haluer of freeHaulers) {
        let targetSourceId = undefined
        let targetRoomName = undefined
        let score = 0

        const capacity = haluer.store.getCapacity()

        source:
        for (const sourceId in sourceStats) {
            const memory = getRoomMemory(targetRoomName)
            if (memory.isCombatant) {
                continue
            }
            const stat = sourceStats[sourceId]
            if (stat.intermediates) {
                for (const intermediate of stat.intermediates) {
                    if (getRoomMemory(intermediate).isCombatant) {
                        continue source
                    }
                }
            }
            if (haluer.ticksToLive < 2 * stat.pathLength * 1.1) {
                continue
            }

            const expectedEnergyDelta = getSourceExpectedEnergyDelta(stat)
            console.log(expectedEnergyDelta)
            const expectedEnergy = stat.energyAmountNear + expectedEnergyDelta

            if (expectedEnergy < capacity) {
                continue
            }

            const currentScore = expectedEnergy / stat.pathLength

            if (currentScore > score) {
                targetSourceId = sourceId
                targetRoomName = stat.roomName
                score = currentScore
                continue
            }
        }
        if (score > 0) {
            haluer.memory.targetRoomName = targetRoomName
            haluer.memory.sourceId = targetSourceId
            sourceStats[targetSourceId].energyAmountNear -= capacity
            runRemoteHauler(haluer, this, targetRoomName)
        } else {
            haluer.say('😴', true)
            this.heap.numIdlingRemoteHaulerCarryParts += haluer.getActiveBodyparts(CARRY)
            Game.map.visual.text(`😴`, haluer.pos, { fontSize: 5 })
        }
    }
}

function getSourceExpectedEnergyDelta(stat) {
    console.log(JSON.stringify(stat))

    if (stat.pathLength < stat.regeneration) {
        return Math.min(stat.energy, HARVEST_POWER * stat.work * stat.pathLength)
    }

    return Math.min(stat.energy, HARVEST_POWER * stat.work * stat.regeneration) + HARVEST_POWER * stat.work * (stat.pathLength - stat.regeneration)
}

function runRemoteHauler(creep, base, targetRoomName) {
    base.heap.numRemoteHaulerCarryParts += creep.getActiveBodyparts(CARRY)

    if (creep.spawning) {
        return
    }

    if (targetRoomName && getRoomMemory(targetRoomName).isCombatant) {
        runAway(creep, creep.memory.base)
        if (creep.room.name === creep.memory.base) {
            delete creep.memory.targetRoomName
            delete creep.memory.sourceId
        }
        return
    }

    const hostileCreeps = creep.room.getEnemyCombatants()

    const roomType = getRoomType(creep.room.name)

    if (roomType === 'sourceKeeper') {
        if (creep.pos.findInRange(hostileCreeps, SOURCE_KEEPER_RANGE_TO_START_FLEE).length > 0) {
            creep.fleeFrom(hostileCreeps, SOURCE_KEEPER_RANGE_TO_FLEE)
            return
        }

        const keeperLairs = creep.room.find(FIND_HOSTILE_STRUCTURES).filter(structure => {
            if (structure.structureType !== STRUCTURE_KEEPER_LAIR) {
                return false
            }

            if (structure.ticksToSpawn > 15) {
                return false
            }

            return true
        })

        if (creep.pos.findInRange(keeperLairs, KEEPER_LAIR_RANGE_TO_START_FLEE).length > 0) {
            creep.fleeFrom(keeperLairs, KEEPER_LAIR_RANGE_TO_FLEE)
            return
        }
    } else {
        if (hostileCreeps.length > 0) {
            runAway(creep, base.name)
            return
        }
    }

    if (creep.memory.getRecycled === true) {
        if (creep.room.name === base.name) {
            creep.getRecycled()
            return
        }
        if (!base) {
            creep.suicide()
            return
        }
        creep.moveToRoom(base.name)
        return
    }

    // 논리회로
    if (creep.memory.supplying && creep.store.getUsedCapacity() === 0) {
        creep.memory.supplying = false
        delete creep.memory.targetRoomName
        delete creep.memory.sourceId
    } else if (!creep.memory.supplying && creep.store.getFreeCapacity() === 0) {
        const amount = creep.store.getUsedCapacity(RESOURCE_ENERGY)
        if (base) {
            base.addRemoteProfit(targetRoomName, amount)
        }
        creep.memory.supplying = true
    }

    // 행동
    if (creep.memory.supplying) {
        if (!base) {
            return
        }

        if (creep.room.name === base.name) {
            return
        }

        const spawn = base.structures.spawn[0]
        if (spawn) {
            creep.moveMy({ pos: spawn.pos, range: 3 })
        }
        return
    }

    if (!creep.memory.targetRoomName) {
        return
    }

    if (creep.ticksToLive < 1.1 * (creep.memory.sourcePathLength || 0)) {
        creep.memory.getRecycled = true
        const amount = creep.store.getUsedCapacity(RESOURCE_ENERGY)
        if (base) {
            base.addRemoteProfit(targetRoomName, amount)
        }
        return
    }

    const targetRoom = Game.rooms[targetRoomName]

    if (!targetRoom) {
        creep.moveToRoom(targetRoomName)
        return
    }

    const source = Game.getObjectById(creep.memory.sourceId)

    if (!source) {
        creep.moveToRoom(creep.memory.targetRoomName)
        return
    }

    if (creep.room.name === targetRoomName) {
        if (creep.memory.targetId) {
            if (Game.getObjectById(creep.memory.targetId) && creep.getEnergyFrom(creep.memory.targetId) !== ERR_INVALID_TARGET) {
                return
            }
            delete creep.memory.targetId
        }

        const tombstone = creep.pos.findInRange(FIND_TOMBSTONES, 4).find(tombstone => tombstone.store[RESOURCE_ENERGY] >= 50)

        if (tombstone) {
            creep.memory.targetId = tombstone.id
            creep.getEnergyFrom(tombstone.id)
            return
        }

        const droppedResource = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 4).find(resource => resource.resourceType !== RESOURCE_ENERGY || resource.amount >= 50)

        if (droppedResource) {
            if (creep.pos.getRangeTo(droppedResource) > 1) {
                creep.moveMy({ pos: droppedResource.pos, range: 1 })
                return
            }
            creep.pickup(droppedResource)
            return
        }
    }

    const energyThreshold = Math.min(creep.store.getFreeCapacity(), 500)

    const container = source.pos.findInRange(FIND_STRUCTURES, 1).find(structure => structure.store && structure.store.getUsedCapacity() >= energyThreshold)

    if (container) {
        if (creep.pos.getRangeTo(container) > 1) {
            creep.moveMy({ pos: container.pos, range: 1 })
            return
        }
        for (const resourceType in container.store) {
            if (creep.withdraw(container, resourceType) === OK) {
                const spawn = base.structures.spawn[0]
                if (spawn) {
                    creep.moveMy({ pos: spawn.pos, range: 3 })
                }
            }
        }
        return
    } else {
        const remoteMiner = source.pos.findInRange(creep.room.creeps.remoteMiner, 1).find(creep => creep.store && creep.store.getUsedCapacity() > 0)
        if (remoteMiner) {
            if (creep.pos.getRangeTo(remoteMiner) > 1) {
                creep.moveMy({ pos: remoteMiner.pos, range: 1 })
                return
            }
            for (const resourceType in remoteMiner.store) {
                if (remoteMiner.transfer(creep, resourceType) === OK) {
                    break
                }
            }
            return
        }
    }

    if (creep.pos.getRangeTo(source.pos) > 2) {
        creep.moveMy({ pos: source.pos, range: 2 })
        return
    }

    base.heap.numIdlingRemoteHaulerCarryParts += creep.getActiveBodyparts(CARRY)
    Game.map.visual.text(`😴`, creep.pos, { fontSize: 5 })
    creep.say('😴', true)

    creep.setWorkingInfo(source.pos, 2)
    return
}

Room.prototype.constructRemote = function (targetRoomName, constructionComplete) {
    if (!targetRoomName && constructionComplete) {
        delete this.heap.remoteNameToConstruct

        if (Math.random() < 0.005) {
            const roadDecayInfo = this.getRemoteRoadDecayInfo()
            const score = roadDecayInfo.lostHits + roadDecayInfo.numLowHits * 5000
            const criteria = 3 * REPAIR_POWER * CREEP_LIFE_TIME
            if (!this.memory.repairRemote && score > criteria) {
                this.memory.repairRemote = true
            } else if (this.memory.repairRemote && score < (criteria / 10)) {
                this.memory.repairRemote = false
            }
        }

        const remoteBuilders = Overlord.getCreepsByRole(this.name, 'remoteBuilder')

        if (this.memory.repairRemote) {
            if (remoteBuilders.length === 0) {
                this.requestRemoteBuilder()
            }
            for (const remoteBuilder of remoteBuilders) {
                runRemoteRepairer(remoteBuilder)
            }
            return
        }

        for (const remoteBuilder of remoteBuilders) {
            if (remoteBuilder.room.name !== this.name || isEdgeCoord(remoteBuilder.pos.x, remoteBuilder.pos.y)) {
                remoteBuilder.moveToRoom(this.name)
            } else {
                remoteBuilder.memory.role = 'laborer'
                remoteBuilder.memory.isBuilder = true
            }
        }

        return
    }

    const roomType = getRoomType(targetRoomName)
    if (roomType === 'sourceKeeper') {
        constructSourceKeeperRoomInfra(this, targetRoomName)
        return
    }

    const targetRoom = Game.rooms[targetRoomName]
    if (!targetRoom) {
        return
    }

    const remoteStatus = this.getRemoteStatus(targetRoomName)

    const roomNameToConstruct = remoteStatus.roomNameToConstruct
    this.heap.remoteNameToConstruct = roomNameToConstruct

    const activeRemotes = this.getActiveRemotes()

    const remoteInfoToConstruct = activeRemotes.find(info => info.remoteName === roomNameToConstruct)

    const remoteInfo = activeRemotes.find(info => info.remoteName === targetRoomName)
    // value, spawntime, sourceIds

    const sourceIds = remoteInfo.sourceIds

    if (remoteInfoToConstruct) {
        const sourceIdsToConstruct = remoteInfoToConstruct.sourceIds

        const remoteBuilders = Overlord.getCreepsByRole(this.name, 'remoteBuilder').filter(creep => {
            if (creep.spawning) {
                return true
            }
            return creep.ticksToLive > creep.body.length * CREEP_SPAWN_TIME
        })

        let remoteBuilderNumWork = 0
        let i = 0
        for (const remoteBuilder of remoteBuilders) {
            remoteBuilder.memory.targetRoomName = roomNameToConstruct
            const index = i % (sourceIdsToConstruct.length)
            const sourceIdToConstruct = sourceIdsToConstruct[index]
            i++
            runRemoteBuilder(remoteBuilder, roomNameToConstruct, sourceIdToConstruct)
            remoteBuilderNumWork += remoteBuilder.getActiveBodyparts(WORK)
        }

        if ((remoteBuilderNumWork < 6 * sourceIdsToConstruct.length) || (remoteBuilders.length % sourceIdsToConstruct.length !== 0)) {
            this.requestRemoteBuilder()
        }
    }

    if (Math.random() < 0.9) {
        return
    }

    remoteStatus.constructionComplete = remoteStatus.constructionComplete || false

    const blueprint = this.getRemoteBlueprint(targetRoomName)

    let complete = true

    remoteStatus.roomNameToConstruct = undefined
    for (const sourceId of sourceIds) {
        const info = blueprint[sourceId]
        const packedStructures = info.structures
        let numConstructionSites = 0
        let currentRoomName = undefined
        for (const packedStructure of packedStructures) {
            const parsed = unpackInfraPos(packedStructure)
            const pos = parsed.pos

            if (currentRoomName !== pos.roomName) {
                currentRoomName = pos.roomName
                numConstructionSites = 0
            }

            if (numConstructionSites >= 10) {
                continue
            }

            if (!Game.rooms[pos.roomName]) {
                complete = false
                continue
            }

            if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0) {
                if (!remoteStatus.roomNameToConstruct && pos.roomName !== this.name) {
                    remoteStatus.roomNameToConstruct = pos.roomName
                }
                complete = false
                numConstructionSites++
                continue
            }
            const structureType = parsed.structureType

            if ([ERR_FULL, OK].includes(pos.createConstructionSite(structureType))) {
                complete = false
                numConstructionSites++
                continue
            }
        }
    }

    if (complete) {
        delete remoteStatus.roomNameToConstruct
        remoteStatus.constructionComplete = complete
        remoteStatus.constructionCompleteTime = Game.time
    }
}

Room.prototype.getRemoteRoadDecayInfo = function () {
    if (this._remoteRoadDecayInfo) {
        return this._remoteRoadDecayInfo
    }

    const activeRemotes = this.getActiveRemotes()

    let lostHits = 0
    let numLowHits = 0
    let repairTargetRoomName = undefined
    let repairTargetSourceId = undefined
    let repairTargetLostHitsTotal = 0

    for (const info of activeRemotes) {
        const remoteName = info.remoteName

        if (!Game.rooms[remoteName]) {
            continue
        }

        const sourceIds = info.sourceIds

        const blueprint = this.getRemoteBlueprint(remoteName)

        for (const sourceId of sourceIds) {
            let routeLostHitsTotal = 0
            const sourceBlueprint = blueprint[sourceId]

            const structures = sourceBlueprint.structures

            for (const packed of structures) {
                const unpacked = unpackInfraPos(packed)

                const pos = unpacked.pos

                if (pos.roomName === this.name) {
                    break
                }

                if (!Game.rooms[pos.roomName]) {
                    continue
                }

                const road = pos.lookFor(LOOK_STRUCTURES).find(structure => structure.structureType === STRUCTURE_ROAD)

                if (road) {
                    routeLostHitsTotal += road.hitsMax - road.hits
                    lostHits += road.hitsMax - road.hits
                    if (road.hits / road.hitsMax < 0.3) {
                        numLowHits++
                    }
                    new RoomVisual(unpacked.pos.roomName).circle(unpacked.pos)
                }
            }
            if (routeLostHitsTotal > repairTargetLostHitsTotal) {
                repairTargetLostHitsTotal = routeLostHitsTotal
                repairTargetRoomName = remoteName
                repairTargetSourceId = sourceId
            }
        }
    }

    if (this.memory.activeSK && this.memory.activeSK.length > 0) {
        for (const remoteName of this.memory.activeSK) {

            if (!Game.rooms[remoteName]) {
                continue
            }

            const infraPlan = getSourceKeeperRoomInfraPlan(this, remoteName)

            for (const sourceId in infraPlan) {
                let routeLostHitsTotal = 0
                const sourceBlueprint = infraPlan[sourceId]

                const structures = sourceBlueprint.infraPlan

                for (const packed of structures) {
                    const unpacked = unpackInfraPos(packed)

                    const pos = unpacked.pos

                    if (pos.roomName === this.name) {
                        break
                    }

                    if (!Game.rooms[pos.roomName]) {
                        continue
                    }

                    const road = pos.lookFor(LOOK_STRUCTURES).find(structure => structure.structureType === STRUCTURE_ROAD)

                    if (road) {
                        routeLostHitsTotal += road.hitsMax - road.hits
                        lostHits += road.hitsMax - road.hits
                        if (road.hits / road.hitsMax < 0.3) {
                            numLowHits++
                        }
                        new RoomVisual(unpacked.pos.roomName).circle(unpacked.pos)
                    }
                }
                if (routeLostHitsTotal > repairTargetLostHitsTotal) {
                    repairTargetLostHitsTotal = routeLostHitsTotal
                    repairTargetRoomName = remoteName
                    repairTargetSourceId = sourceId
                }
            }
        }
    }

    return this._remoteRoadDecayInfo = { lostHits, numLowHits, repairTargetRoomName, repairTargetSourceId }
}

function runRemoteRepairer(creep) {
    if (creep.spawning) {
        return
    }

    const base = Game.rooms[creep.memory.base]

    if (!creep.memory.targetRoomName || !creep.memory.sourceId) {
        const remoteRoadDecayInfo = base.getRemoteRoadDecayInfo()
        const targetRoomName = remoteRoadDecayInfo.repairTargetRoomName
        const sourceId = remoteRoadDecayInfo.repairTargetSourceId
        if (!targetRoomName || !sourceId) {
            return
        }
        creep.memory.targetRoomName = targetRoomName
        creep.memory.sourceId = sourceId
    }

    const targetRoomName = creep.memory.targetRoomName
    const sourceId = creep.memory.sourceId

    if (targetRoomName && getRoomMemory(targetRoomName).isCombatant) {
        runAway(creep, creep.memory.base)
        return
    }

    const hostileCreeps = creep.room.getEnemyCombatants()

    const roomType = getRoomType(creep.room.name)

    if (roomType === 'sourceKeeper') {
        if (creep.pos.findInRange(hostileCreeps, SOURCE_KEEPER_RANGE_TO_START_FLEE).length > 0) {
            creep.fleeFrom(hostileCreeps, SOURCE_KEEPER_RANGE_TO_FLEE)
            return
        }

        const keeperLairs = creep.room.find(FIND_HOSTILE_STRUCTURES).filter(structure => {
            if (structure.structureType !== STRUCTURE_KEEPER_LAIR) {
                return false
            }

            if (structure.ticksToSpawn > 15) {
                return false
            }

            return true
        })

        if (creep.pos.findInRange(keeperLairs, KEEPER_LAIR_RANGE_TO_START_FLEE).length > 0) {
            creep.fleeFrom(keeperLairs, KEEPER_LAIR_RANGE_TO_FLEE)
            return
        }
    } else {
        if (hostileCreeps.length > 0) {
            runAway(creep, base.name)
            return
        }
    }

    // 논리회로
    if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
        delete creep.memory.targetRoomName
        delete creep.memory.sourceId
        creep.memory.working = false
    } else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        const source = Game.getObjectById(sourceId)
        if (source && source.pos.getRangeTo(creep) <= 2) {
            creep.memory.working = true
            delete creep.heap.targetId
        }
    }

    // 행동
    if (creep.memory.working) {
        if (creep.room.name === base.name) {
            delete creep.memory.targetRoomName
            delete creep.memory.sourceId
            creep.memory.working = false
            return
        }

        const closeBrokenThings = creep.pos.findInRange(FIND_STRUCTURES, 3).filter(structure => structure.structureType === STRUCTURE_ROAD && structure.hits < structure.hitsMax)
        if (closeBrokenThings.length) {
            creep.repair(closeBrokenThings[0])
            return
        }

        const spawn = base.structures.spawn[0]
        if (spawn) {
            creep.moveMy({ pos: spawn.pos, range: 3 })
        }
        return
    }

    const targetRoom = Game.rooms[targetRoomName]

    if (!targetRoom) {
        creep.moveToRoom(targetRoomName)
        return
    }

    const tombstone = creep.pos.findInRange(FIND_TOMBSTONES, 4).find(tombstone => tombstone.store[RESOURCE_ENERGY] >= 50)

    if (tombstone) {
        creep.memory.targetId = tombstone.id
        creep.getEnergyFrom(tombstone.id)
        return
    }

    const droppedResource = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 4).find(resource => resource.resourceType === RESOURCE_ENERGY)

    if (droppedResource) {
        if (creep.pos.getRangeTo(droppedResource) > 1) {
            creep.moveMy({ pos: droppedResource.pos, range: 1 })
            return
        }
        creep.pickup(droppedResource)
        return
    }

    const source = Game.getObjectById(sourceId)

    if (!source) {
        return
    }

    const energyThreshold = Math.min(creep.store.getFreeCapacity(), 500)

    const container = source.pos.findInRange(FIND_STRUCTURES, 1).find(structure => structure.store && structure.store.getUsedCapacity() >= energyThreshold)

    if (container) {
        if (creep.pos.getRangeTo(container) > 1) {
            creep.moveMy({ pos: container.pos, range: 1 })
            return
        }
        for (const resourceType in container.store) {
            creep.withdraw(container, resourceType) === OK
        }
        return
    }

    if (creep.pos.getRangeTo(source.pos) > 2) {
        creep.moveMy({ pos: source.pos, range: 2 })
        return
    }
}

function runRemoteBuilder(creep, targetRoomName, sourceId) {
    if (creep.spawning) {
        return
    }

    if (targetRoomName && getRoomMemory(targetRoomName).isCombatant) {
        runAway(creep, creep.memory.base)
        return
    }

    const hostileCreeps = creep.room.getEnemyCombatants()

    if (hostileCreeps.length > 0) {
        runAway(creep, base.name)
        return
    }

    if (creep.room.name !== targetRoomName) {
        creep.moveToRoom(targetRoomName)
        return
    }

    // 논리회로
    if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
        creep.memory.working = false
    } else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true
        delete creep.heap.targetId
    }

    // 행동
    if (creep.memory.working) {
        const constructionSites = creep.room.constructionSites

        if (constructionSites.length > 0 && creep.store.getUsedCapacity(RESOURCE_ENERGY)) {
            if (!creep.heap.targetId || !Game.getObjectById(creep.heap.targetId)) {
                creep.heap.targetId = creep.pos.findClosestByRange(constructionSites).id
            }

            const target = Game.getObjectById(creep.heap.targetId)

            if (!target) {
                return
            }

            if (creep.pos.getRangeTo(target) > 3) {
                creep.moveMy({ pos: target.pos, range: 3 })
                return
            }

            creep.setWorkingInfo(target.pos, 3)
            creep.build(target)
        }

        return
    }

    const targetRoom = Game.rooms[targetRoomName]

    if (!targetRoom) {
        return
    }

    const tombstone = creep.pos.findInRange(FIND_TOMBSTONES, 4).find(tombstone => tombstone.store[RESOURCE_ENERGY] >= 50)

    if (tombstone) {
        creep.memory.targetId = tombstone.id
        creep.getEnergyFrom(tombstone.id)
        return
    }

    const droppedResource = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 4).find(resource => resource.resourceType === RESOURCE_ENERGY)

    if (droppedResource) {
        if (creep.pos.getRangeTo(droppedResource) > 1) {
            creep.moveMy({ pos: droppedResource.pos, range: 1 })
            return
        }
        creep.pickup(droppedResource)
        return
    }

    const source = Game.getObjectById(sourceId)

    if (!source) {
        return
    }

    const energyThreshold = Math.min(creep.store.getFreeCapacity(), 500)

    const container = source.pos.findInRange(FIND_STRUCTURES, 1).find(structure => structure.store && structure.store.getUsedCapacity() >= energyThreshold)

    if (container) {
        if (creep.pos.getRangeTo(container) > 1) {
            creep.moveMy({ pos: container.pos, range: 1 })
            return
        }
        for (const resourceType in container.store) {
            creep.withdraw(container, resourceType) === OK
        }
        return
    }

    if (creep.pos.getRangeTo(source.pos) > 2) {
        creep.moveMy({ pos: source.pos, range: 2 })
        return
    }
}

Room.prototype.requestRemoteBuilder = function () {
    const maxWork = 6

    if (!this.hasAvailableSpawn()) {
        return
    }

    const model = getBuilderModel(this.energyCapacityAvailable, maxWork)

    const body = model.body

    const name = `${this.name} remoteBuilder ${Game.time}_${this.spawnQueue.length}`

    const memory = {
        role: 'remoteBuilder',
        working: false,
        base: this.name,
    }

    let priority = SPAWN_PRIORITY['remoteBuilder']

    const spawnOptions = { priority }

    const request = new RequestSpawn(body, name, memory, spawnOptions)
    this.spawnQueue.push(request)
}


Room.prototype.spawnRemoteWorkers = function (remotesToSpawn, constructionComplete) {
    const fontSize = 4
    const opacity = 1
    const black = '#000000'

    this.memory.currentRemoteIncome = 0

    let requested = false

    const canReserve = this.energyCapacityAvailable >= 650

    const avgCpu = Overlord.getAverageCpu()

    const needBigMiner = this.controller.level >= 6 && (avgCpu / (Game.cpu.limit) > 0.8 || Game.cpu.bucket < 9000)

    let numHauler = 0
    let numCarry = 0
    let maxCarry = 0

    const ratio = this.storage ? 1 : 0.8
    const energyCapacity = Math.max(this.energyCapacityAvailable * ratio, 300)

    const maxHaulerCarry = constructionComplete
        ? 2 * Math.min(Math.floor(energyCapacity / 150), 16) // with road
        : Math.min(Math.floor(energyCapacity / 100), 25) // without road

    const haulers = Overlord.getCreepsByRole(this.name, 'remoteHauler').filter(creep => {
        if (creep.spawning) {
            return true
        }
        if (creep.memory.getRecycled) {
            return false
        }
        return creep.ticksToLive > (creep.body.length * CREEP_SPAWN_TIME)
    })

    for (const hauler of haulers) {
        numCarry += hauler.getActiveBodyparts(CARRY)
        numHauler++
    }

    outer:
    for (const info of remotesToSpawn) {
        const targetRoomName = info.remoteName

        const status = this.getRemoteStatus(targetRoomName)

        const sourceIds = info.sourceIds

        const isSoucrKeeperRoom = info.isSoucrKeeperRoom

        if (isSoucrKeeperRoom) {

        }

        const blueprint = this.getRemoteBlueprint(targetRoomName)

        if (!blueprint) {
            continue
        }

        const reservationTick = getReservationTick(targetRoomName)
        Game.map.visual.text(`⏰${reservationTick}`, new RoomPosition(49, 45, targetRoomName), { fontSize: 5, align: 'right' })

        const remoteStatus = this.getRemoteStatus(targetRoomName)

        if (reservationTick < 0) {
            if (canReserve) {
                const reservers = Overlord.getCreepsByRole(targetRoomName, 'reserver')
                const numClaimParts = reservers.map(creep => creep.getActiveBodyparts('claim')).reduce((a, b) => a + b, 0)

                if (numClaimParts < 2 && reservers.length < (remoteStatus.controllerAvailable || 2)) {
                    this.requestReserver(targetRoomName)
                    requested = true
                    continue outer
                }
            }
            continue
        }

        const maxWork = canReserve ? 5 : 3

        const sourceStat = {}

        for (const sourceId of sourceIds) {
            const sourceBlueprint = blueprint[sourceId]
            const sourceMaxCarry = sourceBlueprint.maxCarry * (canReserve ? 1 : 0.3)
            sourceStat[sourceId] = { numMiner: 0, work: 0, pathLength: sourceBlueprint.pathLength, maxWork, maxCarry: sourceMaxCarry }

            if (this.heap.remoteNameToConstruct && this.heap.remoteNameToConstruct === targetRoomName) {
                const source = Game.getObjectById(sourceId)
                if (source && source.energyAmountNear < 500) {
                    continue
                }
            }
            maxCarry += sourceMaxCarry
            // If you cannot reserve, 2.5 e/tick + no container, so it decays 1e/tick. So it becomes 1.5e / tick. which is 0.3 of 5e/tick
        }

        const targetRoom = Game.rooms[targetRoomName]

        const miners = Overlord.getCreepsByRole(targetRoomName, 'remoteMiner').filter(creep => {
            if (creep.spawning) {
                return true
            }
            const stat = sourceStat[creep.memory.sourceId]
            if (!stat) {
                return false
            }
            const pathLength = sourceStat[creep.memory.sourceId].pathLength
            return creep.ticksToLive > (creep.body.length * CREEP_SPAWN_TIME + pathLength)
        })

        for (const miner of miners) {
            const sourceId = miner.memory.sourceId
            sourceStat[sourceId].work += miner.getActiveBodyparts(WORK)
            sourceStat[sourceId].numMiner++
        }

        status.sourceStat = sourceStat

        const constructionSites = targetRoom ? targetRoom.constructionSites : []
        const constructing = constructionSites.length > 0

        if (!constructing) {
            let income = 0
            const value = this.getRemoteValue(targetRoomName)
            for (const sourceId of sourceIds) {
                const deficiency = maxCarry - numCarry
                const minerRatio = sourceStat[sourceId].work / maxWork
                const haulerRatio = (sourceStat[sourceId].maxCarry - deficiency) / sourceStat[sourceId].maxCarry
                income += value[sourceId] * Math.min(1, minerRatio, haulerRatio)
            }
            this.memory.currentRemoteIncome += income
        }

        let x = 10
        for (const sourceId of sourceIds) {
            const stat = sourceStat[sourceId]
            Game.map.visual.text(`⛏️${stat.work}/${maxWork}`, new RoomPosition(x, 20, targetRoomName), { fontSize, backgroundColor: stat.work >= maxWork ? black : COLOR_NEON_RED, opacity })
            const source = Game.getObjectById(sourceId)
            if (source) {
                const amountNear = source.energyAmountNear
                Game.map.visual.text(`🔋${amountNear}/2000 `, new RoomPosition(x, 25, targetRoomName), { fontSize, backgroundColor: amountNear < 2000 ? black : COLOR_NEON_RED, opacity })
            }
            x += 30
        }

        if (requested) {
            continue
        }

        const memory = getRoomMemory(targetRoomName)
        if (memory.invaderCore) {
            const coreAttackers = Overlord.getCreepsByRole(targetRoomName, 'coreAttacker')
            if (coreAttackers.length === 0) {
                room.requestCoreAttacker(targetRoomName)
                requested = true
                continue outer
            }
        }

        if (canReserve && reservationTick < RESERVATION_TICK_THRESHOLD) {
            const reservers = Overlord.getCreepsByRole(targetRoomName, 'reserver')
            const numClaimParts = reservers.map(creep => creep.getActiveBodyparts('claim')).reduce((a, b) => a + b, 0)

            if (numClaimParts < 2 && reservers.length < (remoteStatus.controllerAvailable || 2)) {
                this.requestReserver(targetRoomName)
                requested = true
                continue outer
            }
        }

        for (const sourceId of sourceIds) {
            const sourceBlueprint = blueprint[sourceId]
            const stat = sourceStat[sourceId]

            if (stat.work < maxWork && stat.numMiner < sourceBlueprint.available) {
                let containerId = undefined
                if (Game.getObjectById(sourceBlueprint.containerId)) {
                    containerId = sourceBlueprint.containerId
                } else if (targetRoom) {
                    const containerPacked = sourceBlueprint.structures.find(packed => {
                        const parsed = unpackInfraPos(packed)
                        return parsed.structureType === 'container'
                    })
                    const containerUnpacked = unpackInfraPos(containerPacked)
                    const container = containerUnpacked.pos.lookFor(LOOK_STRUCTURES).find(structure => structure.structureType === 'container')
                    if (container) {
                        containerId = sourceBlueprint.containerId = container.id
                    }
                }
                const numWork = maxWork === 5 ? (needBigMiner ? 12 : 6) : maxWork
                this.requestRemoteMiner(targetRoomName, sourceId, { containerId, maxWork: numWork, needCarry: canReserve })
                requested = true
                continue outer
            }

            if (numCarry < maxCarry) {
                this.requestRemoteHauler({ maxCarry: maxHaulerCarry, noRoad: !constructionComplete })
                requested = true
                continue outer
            }
        }
    }

    maxCarry = Math.ceil(maxCarry)

    Game.map.visual.text(`🚚${numCarry}/${maxCarry} `, new RoomPosition(25, 35, this.name), { fontSize, backgroundColor: numCarry >= maxCarry ? black : COLOR_NEON_RED, opacity })


    if (this.heap.numIdlingRemoteHaulerCarryParts > 0) {
        const idlingPercentage = Math.floor((this.heap.numIdlingRemoteHaulerCarryParts / numCarry) * 10000) / 100
        Game.map.visual.text(`😴${idlingPercentage}%`, new RoomPosition(25, 40, this.name), { fontSize, backgroundColor: COLOR_NEON_RED, opacity: 1 })
    }
    Game.map.visual.text(`🚚${numCarry}/${maxCarry} `, new RoomPosition(25, 35, this.name), { fontSize, backgroundColor: numCarry >= maxCarry ? black : COLOR_NEON_RED, opacity })
}

Room.prototype.requestRemoteMiner = function (targetRoomName, sourceId, options = {}) {
    if (!this.hasAvailableSpawn()) {
        return
    }

    const maxWork = options.maxWork || 6

    const model = getRemoteMinerModel(this.energyCapacityAvailable, maxWork)

    const body = model.body

    const cost = model.cost

    const name = `${targetRoomName} remoteMiner ${Game.time}_${this.spawnQueue.length}`
    const memory = {
        role: 'remoteMiner',
        base: this.name,
        targetRoomName,
        sourceId,
    }

    const spawnOptions = {}
    spawnOptions.priority = SPAWN_PRIORITY['remoteMiner']
    spawnOptions.cost = cost

    if (options.keeperLairId) {
        memory.keeperLairId = options.keeperLairId
    }

    if (options.containerId) {
        memory.containerId = options.containerId
    }

    const request = new RequestSpawn(body, name, memory, spawnOptions)
    this.spawnQueue.push(request)
}

function getRemoteMinerModel(energyCapacity, maxWork) {
    let cost = 0
    let work = 0
    let move = 0
    let carry = 0
    while (cost < energyCapacity && work + move + carry < MAX_CREEP_SIZE) {
        if ((move === 0 || (work / move >= 2)) && energyCapacity >= cost + BODYPART_COST[MOVE]) {
            move++
            cost += BODYPART_COST[MOVE]
            continue
        }

        if (work >= 5 && carry < 1 && energyCapacity >= cost + BODYPART_COST[CARRY]) {
            carry++
            cost += BODYPART_COST[CARRY]
            continue
        }


        if (maxWork && work >= maxWork) {
            break
        }

        if (energyCapacity >= cost + BODYPART_COST[WORK]) {
            work++
            cost += BODYPART_COST[WORK]
            continue
        }
        break
    }

    const body = parseBody(`${work - 1}w${carry}c${move}m1w`)

    return { body, numWork: work, cost }
}

Room.prototype.requestRemoteHauler = function (options = {}) {
    if (!this.hasAvailableSpawn()) {
        return
    }

    const body = []
    let cost = 0


    const name = `${this.name} remoteHauler ${Game.time}_${this.spawnQueue.length}`
    const memory = {
        role: 'remoteHauler',
        base: this.name,
    }

    if (options.noRoad) {
        const energyCapacity = this.energyCapacityAvailable

        const maxCarry = options.maxCarry || 25

        for (let i = 0; i < Math.min(maxCarry, 25); i++) {
            if (energyCapacity < cost + 100) {
                break
            }
            body.push(CARRY, MOVE)
            cost += 100
        }
    } else {
        memory.useRoad = true

        const energyCapacity = this.energyCapacityAvailable

        const maxCarry = options.maxCarry || 32

        for (let i = 0; i < Math.min(32, Math.ceil(maxCarry / 2)); i++) {
            if (energyCapacity < cost + 150) {
                break
            }
            body.push(CARRY, CARRY, MOVE)
            cost += 150
        }
    }

    const spawnOptions = {}
    spawnOptions.priority = SPAWN_PRIORITY['remoteHauler']
    spawnOptions.cost = cost

    const request = new RequestSpawn(body, name, memory, spawnOptions)
    this.spawnQueue.push(request)
}

function getReservationTick(targetRoomName) {
    const targetRoom = Game.rooms[targetRoomName]
    if (!targetRoom) {
        return 0
    }

    if (!targetRoom.controller) {
        return 0
    }

    if (!targetRoom.controller.reservation) {
        return 0
    }

    const reservation = targetRoom.controller.reservation

    const sign = reservation.username === MY_NAME ? 1 : -1

    return reservation.ticksToEnd * sign
}

function getInvaderStrengthThreshold(level) {
    return Math.exp((level - 1) * 0.4) * 100
}

// get remote net income per tick with EMA
Room.prototype.getRemoteNetIncomePerTick = function (targetRoomName) {
    const remoteStatus = this.getRemoteStatus(targetRoomName)

    if (!remoteStatus.startTick) {
        delete remoteStatus.netIncome
    }

    remoteStatus.startTick = remoteStatus.startTick || Game.time
    remoteStatus.lastTick = remoteStatus.lastTick || Game.time
    const netIncome = remoteStatus.netIncome || 0

    const interval = Game.time - remoteStatus.lastTick

    // 1 unit with alpha = 0.2
    // recent unit is weighted by 0.2
    // previous unit is wighted by 0.2 * 0.8
    const alpha = 0.2

    if (interval >= CREEP_LIFE_TIME) {
        if (remoteStatus.netIncomePerTick) {
            const modifiedAlpha = 1 - Math.pow(1 - alpha, interval / CREEP_LIFE_TIME)
            remoteStatus.netIncomePerTick = modifiedAlpha * (netIncome / interval) + (1 - modifiedAlpha) * remoteStatus.netIncomePerTick
        } else {
            remoteStatus.netIncomePerTick = netIncome / interval
        }
        remoteStatus.lastTick = Game.time
        remoteStatus.netIncome = 0
    }

    if (!remoteStatus.netIncomePerTick) {
        return netIncome / interval
    }

    return remoteStatus.netIncomePerTick
}

Room.prototype.addRemoteCost = function (targetRoomName, amount) {
    const remoteStatus = this.getRemoteStatus(targetRoomName)
    if (remoteStatus) {
        remoteStatus.netIncome = remoteStatus.netIncome || 0
        remoteStatus.netIncome -= amount
        return
    }
    const sourceKeeperMiningInfo = this.getSourceKeeperMiningInfo(targetRoomName)
    if (sourceKeeperMiningInfo) {
        sourceKeeperMiningInfo.netIncome = sourceKeeperMiningInfo.netIncome || 0
        sourceKeeperMiningInfo.netIncome -= amount
        return
    }
}

Room.prototype.addRemoteProfit = function (targetRoomName, amount) {
    const remoteStatus = this.getRemoteStatus(targetRoomName)
    if (remoteStatus) {
        remoteStatus.netIncome = remoteStatus.netIncome || 0
        remoteStatus.netIncome += amount
        return
    }
    const sourceKeeperMiningInfo = this.getSourceKeeperMiningInfo(targetRoomName)
    if (sourceKeeperMiningInfo) {
        sourceKeeperMiningInfo.netIncome = sourceKeeperMiningInfo.netIncome || 0
        sourceKeeperMiningInfo.netIncome += amount
        return
    }
}

Room.prototype.getActiveRemoteNames = function () {
    const activeRemotes = this.getActiveRemotes() || []
    return activeRemotes.map(remoteInfo => remoteInfo.remoteName)
}

Room.prototype.resetActiveRemotes = function () {
    delete this.memory.activeRemotes
    delete this.memory.activeRemotesTime
}

/**
 * get active remote infos
 * @returns array of objects which contains informations: remoteName, intermediate, value, weight, oneSource
 */
Room.prototype.getActiveRemotes = function () {
    if (this.memory.activeRemotes && this.memory.activeRemotesTime && (Game.time < this.memory.activeRemotesTime + 20)) {
        return this.memory.activeRemotes
    }

    const remoteInfos = []

    for (const remoteName of this.getRemoteNames()) {
        const remoteStatus = this.getRemoteStatus(remoteName)
        if (!remoteStatus) {
            continue
        }
        if (remoteStatus.forbidden) {
            continue
        }

        const block = remoteStatus.block

        // basic

        const value = this.getRemoteValue(remoteName)
        const spawnUsage = this.getRemoteSpawnUsage(remoteName)

        if (!value || !spawnUsage) {
            continue
        }

        const intermediates = remoteStatus.intermediates

        const info = { remoteName, intermediates, value: value.total, weight: spawnUsage.total, sourceIds: Object.keys(remoteStatus.blueprint), block }

        remoteInfos.push(info)

        if (remoteStatus.numSource <= 1) {
            continue
        }

        // oneSource
        const betterSourceId = remoteStatus.betterSourceId
        const info2 = { remoteName, intermediates, value: value[betterSourceId], weight: spawnUsage[betterSourceId] + (spawnUsage.reserve || 0), sourceIds: [betterSourceId], block }

        remoteInfos.push(info2)
    }

    let spawnCapacityForRemotes = Math.floor(this.structures.spawn.length * 485 - this.getBasicSpawnCapacity())

    if (spawnCapacityForRemotes <= 0) {
        this.memory.activeRemotesTime = Game.time
        return this.memory.activeRemotes = []
    }

    if (this.memory.activeSK) {
        for (const targetRoomName of this.memory.activeSK) {
            spawnCapacityForRemotes -= Math.floor(this.getSourceKeeperRoomSpawnUsage(targetRoomName))
        }
    }

    // vaules
    const table = new Array(spawnCapacityForRemotes + 1).fill(0)

    // remoteNames
    const resultTable = new Array(spawnCapacityForRemotes + 1)
    for (let i = 0; i < resultTable.length; i++) {
        resultTable[i] = []
    }

    // DP starts
    for (let i = 0; i < remoteInfos.length; i++) {
        const info = remoteInfos[i]
        const remoteName = remoteInfos[i].remoteName
        const w = Math.ceil(info.weight)
        const v = info.value
        const intermediateNames = info.intermediates
        for (let j = spawnCapacityForRemotes; j > 0; j--) {
            if (j + w > spawnCapacityForRemotes || table[j] === 0) {
                continue
            }

            const resultRemoteNames = resultTable[j].map(info => info.remoteName)

            if (resultRemoteNames.includes(remoteName)) {
                continue
            }

            if (intermediateNames && intermediateNames.some(intermediateName => !resultRemoteNames.includes(intermediateName))) {
                continue
            }

            if (table[j] + v > table[j + w]) {
                table[j + w] = table[j] + v
                resultTable[j + w] = [...resultTable[j], info]
            }
        }

        if (intermediateNames && intermediateNames.length > 0) {
            continue
        }

        if (v > table[w]) {
            table[w] = v
            resultTable[w] = [...resultTable[0], info]
        }
    }

    // find best option
    let result = []
    let bestValue = 0
    for (let i = 0; i < table.length; i++) {
        if (table[i] > bestValue) {
            bestValue = table[i]
            result = resultTable[i]
        }
    }
    this.memory.activeRemotesTime = Game.time
    return this.memory.activeRemotes = result
}

Room.prototype.addRemote = function (targetRoomName) {
    this.memory.remotes = this.memory.remotes || {}
    this.memory.remotes[targetRoomName] = {}

    this.resetActiveRemotes()
}

Room.prototype.deleteRemote = function (targetRoomName) {
    this.memory.remotes = this.memory.remotes || {}

    delete this.memory.remotes[targetRoomName]

    this.resetActiveRemotes()
}

Room.prototype.getRemoteValue = function (targetRoomName) {
    const remoteStatus = this.getRemoteStatus(targetRoomName)
    const canReserve = this.energyCapacityAvailable >= 650

    if (remoteStatus && remoteStatus.remoteValue && (!!remoteStatus.remoteValue.canReserve === canReserve)) {
        return remoteStatus.remoteValue
    }

    const blueprint = this.getRemoteBlueprint(targetRoomName)

    const result = { canReserve, total: 0, numSource: 0 }

    if (!blueprint) {
        console.log(`${this.name} cannot get blueprint of ${targetRoomName}`)
        return result
    }

    for (const info of Object.values(blueprint)) {
        result.numSource++

        const income = canReserve ? 10 : 5
        const distance = info.pathLength

        const minerCost = (950 / (1500 - distance))
        const haluerCost = (distance * HAULER_RATIO * (canReserve ? 75 : 100) + 100) / 1500
        const creepCost = (minerCost + haluerCost) * (canReserve ? 1 : 0.5)

        const containerCost = canReserve ? 0.5 : 0
        const roadCost = canReserve ? (1.6 * distance + 10 * distance / (1500 - distance) + 1.5 * distance / (600 - distance)) * 0.001 : 0

        const totalCost = creepCost + containerCost + roadCost

        const netIncome = income - totalCost

        result[info.sourceId] = netIncome
        result.total += netIncome
    }

    if (remoteStatus) {
        remoteStatus.remoteValue = result
    }

    return result
}

Room.prototype.getRemoteSpawnUsage = function (targetRoomName) {
    const remoteStatus = this.getRemoteStatus(targetRoomName)
    const canReserve = this.energyCapacityAvailable >= 650

    if (remoteStatus && remoteStatus.spawnUsage && (!!remoteStatus.spawnUsage.canReserve === canReserve)) {
        return remoteStatus.spawnUsage
    }

    const blueprint = this.getRemoteBlueprint(targetRoomName)

    if (!blueprint) {
        return
    }

    const result = { canReserve, total: 0 }

    for (const info of Object.values(blueprint)) {
        result[info.sourceId] = 0
        if (this.controller.level < 8) {
            result[info.sourceId] += 3 * 5 // upgrader. assume that income is 5e/tick
        }
        result[info.sourceId] += 13 // miner
        result[info.sourceId] += info.maxCarry * (canReserve ? 1.5 : 2) // hauler
        if (!canReserve) {
            result[info.sourceId] = result[info.sourceId] * 0.5
        }

        result.total += result[info.sourceId]
    }

    if (canReserve) {
        result.reserve = 5
        result.total += 5
    }

    if (remoteStatus) {
        remoteStatus.spawnUsage = result
    }

    return result
}

Room.prototype.getRemoteBlueprint = function (targetRoomName) {
    const thisName = this.name

    const remoteStatus = this.getRemoteStatus(targetRoomName)
    if (remoteStatus && remoteStatus.blueprint) {
        return remoteStatus.blueprint
    }

    const startingPoint = this.getStoragePos()
    if (!startingPoint) {
        return
    }

    const targetRoom = Game.rooms[targetRoomName]
    if (!targetRoom) {
        return
    }

    const array = []

    const sources = targetRoom.find(FIND_SOURCES)
    const roadPositions = [...this.getAllRemoteRoadPositions()]
    const basePlan = this.basePlan

    const remoteNames = this.getRemoteNames()

    const intermediates = new Set()

    for (const source of sources) {
        const search = PathFinder.search(source.pos, { pos: startingPoint, range: 1 }, {
            plainCost: 5,
            swampCost: 6, // swampCost higher since road is more expensive on swamp
            maxOps: 20000,
            heuristicWeight: 1,
            roomCallback: function (roomName) {
                if (![thisName, targetRoomName, ...remoteNames].includes(roomName)) {
                    return false
                }

                const costs = new PathFinder.CostMatrix;

                for (const pos of roadPositions) {
                    if (pos.roomName === roomName) {
                        costs.set(pos.x, pos.y, 4)
                    }
                }

                const currentRoom = Game.rooms[roomName];
                if (!currentRoom) {
                    return costs;
                }

                currentRoom.find(FIND_STRUCTURES).forEach(function (structure) {
                    if (structure.structureType === STRUCTURE_ROAD) {
                        costs.set(structure.pos.x, structure.pos.y, 4)
                        return
                    }

                    if (OBSTACLE_OBJECT_TYPES.includes(structure.structureType)) {
                        costs.set(structure.pos.x, structure.pos.y, 255)
                        return
                    }

                })

                for (const sourceInner of currentRoom.sources) {
                    if (source.id === sourceInner.id) {
                        continue
                    }
                    for (const pos of sourceInner.pos.getInRange(1)) {
                        if (!pos.isWall && costs.get(pos.x, pos.y) < 50) {
                            costs.set(pos.x, pos.y, 50)
                        }
                    }
                }

                if (roomName === thisName && basePlan) {
                    for (let i = 1; i <= 8; i++) {
                        for (const structure of basePlan[`lv${i}`]) {
                            if (structure.structureType === STRUCTURE_ROAD) {
                                costs.set(structure.pos.x, structure.pos.y, 4)
                                continue
                            }

                            if (OBSTACLE_OBJECT_TYPES.includes(structure.structureType)) {
                                costs.set(structure.pos.x, structure.pos.y, 255)
                            }
                        }
                    }
                }

                return costs;
            }
        })

        if (search.incomplete) {
            console.log(`${this.name} cannot find path to source ${source.id}`)
            continue
        }

        const path = search.path
        const pathLength = path.length

        if (pathLength > MAX_DISTANCE) {
            console.log(`${this.name} is too far to source ${source.id}`)
            continue
        }

        visualizePath(path)

        roadPositions.push(...path)

        const info = {}

        info.sourceId = source.id

        info.available = source.available

        info.pathLength = pathLength

        info.maxCarry = (path.length * HAULER_RATIO * 0.95) + 0.5 // 0.05 for reparing container, 0.5 for buffer

        info.repair = 0

        for (const pos of path) {
            if (pos.isSwamp) {
                info.repair += 0.005
            } else {
                info.repair += 0.001
            }
        }

        const structures = []

        const containerPos = path.shift()

        structures.push(containerPos.packInfraPos('container'))

        for (const pos of path) {
            const roomName = pos.roomName
            if (![thisName, targetRoomName].includes(roomName)) {
                intermediates.add(roomName)
            }
            structures.push(pos.packInfraPos('road'))
        }

        info.structures = structures

        array.push(info)
    }

    if (array.length === 0) {
        return
    }

    array.sort((a, b) => a.pathLength - b.pathLength)

    const result = {}

    for (const info of array) {
        result[info.sourceId] = info
    }

    if (remoteStatus) {
        if (intermediates.size > 0) {
            remoteStatus.intermediates = Array.from(intermediates)
        }

        remoteStatus.numSource = array.length
        remoteStatus.betterSourceId = array[0].sourceId
        remoteStatus.blueprint = result
        remoteStatus.controllerAvailable = targetRoom.controller.pos.available
    }

    return result
}

RoomPosition.prototype.packInfraPos = function (structureType) {
    const coord = this.y * 50 + this.x
    const roomName = this.roomName
    return `${roomName} ${coord} ${structureType}`
}

function unpackInfraPos(packed) {
    const splited = packed.split(' ')
    const roomName = splited[0]
    const coord = splited[1]
    const x = coord % 50
    const y = (coord - x) / 50
    return { pos: new RoomPosition(x, y, roomName), structureType: splited[2] }
}

Room.prototype.getAllRemoteRoadPositions = function () {
    const result = []
    for (const targetRoomName of this.getRemoteNames()) {
        const remoteStatus = this.getRemoteStatus(targetRoomName)
        if (!remoteStatus) {
            continue
        }

        const blueprint = remoteStatus.blueprint
        if (!blueprint) {
            continue
        }

        for (const sourceBlueprint of Object.values(blueprint)) {
            const packedStructures = sourceBlueprint.structures
            for (const packedStructure of packedStructures) {
                const parsed = unpackInfraPos(packedStructure)
                if (parsed.structureType !== STRUCTURE_ROAD) {
                    continue
                }
                const pos = parsed.pos
                result.push(pos)
            }
        }
    }
    return result
}

Room.prototype.getRemoteStatus = function (targetRoomName) {
    this.memory.remotes = this.memory.remotes || {}
    return this.memory.remotes[targetRoomName]
}

Room.prototype.getRemoteNames = function () {
    this.memory.remotes = this.memory.remotes || {}
    return Object.keys(this.memory.remotes)
}

Room.prototype.getStoragePos = function () {
    if (this.storage) {
        return this.storage.pos
    }
    const basePlan = this.basePlan
    const lv4 = basePlan['lv4']
    const storagePlan = lv4.find(plan => plan.structureType === STRUCTURE_STORAGE)
    if (storagePlan) {
        return storagePlan.pos
    }
}

function runAway(creep, roomName) {
    const hostileCreeps = creep.room.getEnemyCombatants()

    if (creep.memory.role === 'sourceKeeperHandler') {
        creep.heal(creep)
    }

    if (creep.pos.findInRange(hostileCreeps, 5).length > 0) {
        creep.fleeFrom(hostileCreeps, 30, 2)
        return
    }

    if (creep.memory.keeperLairId) {
        const keeperLair = Game.getObjectById(creep.memory.keeperLairId)
        if (keeperLair && keeperLair.ticksToSpawn < 15 && creep.pos.getRangeTo(keeperLair.pos) < 8) {
            creep.fleeFrom(keeperLair, 8)
            return
        }
    }

    if (hostileCreeps.length > 0 || creep.pos.getRangeToEdge() < 5) {
        creep.moveToRoom(roomName)
    }
}

module.exports = {
    runAway,
    runRemoteBuilder,
}
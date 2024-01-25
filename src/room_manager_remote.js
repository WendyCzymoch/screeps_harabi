const { GuardRequest, getCombatInfo, CombatInfo } = require("./overlord_tasks_guard")
const { getRoomMemory } = require("./util")

const MAX_DISTANCE = 120

const HAULER_RATIO = 0.4

Room.prototype.manageRemotes = function () {
    const activeRemoteNames = this.getActiveRemoteNames()
    const remoteNamesToSpawn = []

    const invaderStrengthThreshold = getInvaderStrengthThreshold(this.controller.level) // 1에서 100, 8에서 1644정도

    let remoteNameToConstruct = undefined
    for (const targetRoomName of activeRemoteNames) {

        const memory = getRoomMemory(targetRoomName)

        const info = this.getRemoteInfo(targetRoomName)

        if (!info) {
            continue
        }

        const targetRoom = Game.rooms[targetRoomName]
        if (targetRoom) {
            const invaders = targetRoom.findHostileCreeps()
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

            if (!memory.invaderCore && invaderCore) {
                memory.invaderCore = true
            } else if (memory.invaderCore && !invaderCore) {
                memory.invaderCore = false
            }
        }

        if (memory.isCombatant) {
            if (Game.time > memory.combatantsTicksToLive) {
                delete memory.isCombatant
                delete memory.invader
                delete memory.combatantsTicksToLive
            }
            manageInvasion(this, targetRoomName)
            continue
        }

        if (!remoteNameToConstruct && targetRoom && (!info.constructionComplete || Game.time > (info.constructionCompleteTime + 3000))) {
            remoteNameToConstruct = targetRoomName
        }

        runRemoteWorkers(this, targetRoomName)

        remoteNamesToSpawn.push(targetRoomName)
    }

    if (remoteNameToConstruct) {
        constructRemote(this, remoteNameToConstruct)
    }

    spawnRemoteWorkers(this, remoteNamesToSpawn)
}

Room.prototype.getRemoteNames = function () {
    this.memory.remotes = this.memory.remotes || {}
    return Object.keys(this.memory.remotes)
}

Room.prototype.getRemoteInfo = function (targetRoomName) {
    this.memory.remotes = this.memory.remotes || {}
    return this.memory.remotes[targetRoomName]
}

function getInvaderStrengthThreshold(level) {
    return Math.exp((level - 1) * 0.4) * 100
}

Room.prototype.addRemote = function (targetRoomName) {
    this.memory.remotes = this.memory.remotes || {}
    this.memory.remotes[targetRoomName] = {}

    const memory = getRoomMemory(targetRoomName)
    memory.roomNameInCharge = this.name

    delete this.memory.activeRemoteNames
}

Room.prototype.deleteRemote = function (targetRoomName) {
    this.memory.remotes = this.memory.remotes || {}
    delete this.memory.remotes[targetRoomName]

    const memory = getRoomMemory(targetRoomName)
    delete memory.roomNameInCharge

    delete this.memory.activeRemoteNames
}

Room.prototype.getActiveRemoteNames = function () {
    if (this._activeRemoteNames) {
        return this._activeRemoteNames
    }

    if (Math.random() < 0.1) {
        delete this.memory.activeRemoteNames
    }

    if (this.memory.activeRemoteNames) {
        return this.memory.activeRemoteNames
    }

    const result = []

    sortRemotesByValue(this)

    const remoteNames = this.getRemoteNames()

    let spawnCapacityForRemotes = this.structures.spawn.length * 500

    spawnCapacityForRemotes -= this.getBasicSpawnCapacity()

    if (this.memory.activeSK) {
        for (const targetRoomName of this.memory.activeSK) {
            spawnCapacityForRemotes -= this.getSourceKeeperRoomSpawnUsage(targetRoomName)
        }
    }

    let remotesSpawnUsage = 0

    for (const targetRoomName of remoteNames) {
        const memory = this.getRemoteInfo(targetRoomName)

        if (memory.forbidden) {
            continue
        }

        const intermediateNames = memory.intermediates || []

        if (intermediateNames.some(intermediateName => {
            !result.includes(intermediateName)
        })) {
            continue
        }

        const currentSpawnUsage = this.getRemoteSpawnUsage(targetRoomName)

        if (remotesSpawnUsage + currentSpawnUsage > spawnCapacityForRemotes) {
            continue
        }

        remotesSpawnUsage += currentSpawnUsage
        result.push(targetRoomName)
    }

    return this._activeRemoteNames = this.memory.activeRemoteNames = result
}

function sortRemotesByValue(room) {
    room.memory.remotes = room.memory.remotes || {}

    function getRemoteValuePerSpawnUsage(room, targetRoomName) {
        const value = getRemoteValue(room, targetRoomName)
        const spawnUsage = room.getRemoteSpawnUsage(targetRoomName)
        return value / spawnUsage
    }

    const entries = Object.entries(room.memory.remotes).sort((a, b) =>
        getRemoteValuePerSpawnUsage(room, b[0]) - getRemoteValuePerSpawnUsage(room, a[0]))

    const sorted = {}

    for (const pair of entries) {
        sorted[pair[0]] = pair[1]
    }

    room.memory.remotes = sorted
}

// get remote net income per tick with EMA
Room.prototype.getRemoteNetIncomePerTick = function (targetRoomName) {
    const remoteInfo = this.getRemoteInfo(targetRoomName)

    if (!remoteInfo.startTick) {
        delete remoteInfo.netIncome
    }

    remoteInfo.startTick = remoteInfo.startTick || Game.time
    remoteInfo.lastTick = remoteInfo.lastTick || Game.time
    const netIncome = remoteInfo.netIncome || 0

    const interval = Game.time - remoteInfo.lastTick

    // 1000 tick = 1 unit with alpha = 0.2
    // so, recent 1000 tick is weighted by 0.2
    // previous 1000 tick is wighted by 0.2 * 0.8
    const alpha = 0.2

    if (interval >= 1000) {
        if (remoteInfo.netIncomePerTick) {
            const modifiedAlpha = 1 - Math.pow(1 - alpha, interval / 1000)
            remoteInfo.netIncomePerTick = modifiedAlpha * (netIncome / interval) + (1 - modifiedAlpha) * remoteInfo.netIncomePerTick
        } else {
            remoteInfo.netIncomePerTick = netIncome / interval
        }
        remoteInfo.lastTick = Game.time
        remoteInfo.netIncome = 0
    }

    if (!remoteInfo.netIncomePerTick) {
        return netIncome / interval
    }

    return remoteInfo.netIncomePerTick
}

Room.prototype.addRemoteCost = function (targetRoomName, amount) {
    const remoteInfo = this.getRemoteInfo(targetRoomName)
    if (remoteInfo) {
        remoteInfo.netIncome = remoteInfo.netIncome || 0
        remoteInfo.netIncome -= amount
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
    const remoteInfo = this.getRemoteInfo(targetRoomName)
    if (remoteInfo) {
        remoteInfo.netIncome = remoteInfo.netIncome || 0
        remoteInfo.netIncome += amount
        return
    }
    const sourceKeeperMiningInfo = this.getSourceKeeperMiningInfo(targetRoomName)
    if (sourceKeeperMiningInfo) {
        sourceKeeperMiningInfo.netIncome = sourceKeeperMiningInfo.netIncome || 0
        sourceKeeperMiningInfo.netIncome += amount
        return
    }
}

function runRemoteWorkers(room, targetRoomName) {
    const miners = Overlord.getCreepsByRole(targetRoomName, 'remoteMiner')
    const haulers = Overlord.getCreepsByRole(targetRoomName, 'remoteHauler')
    const reservers = Overlord.getCreepsByRole(targetRoomName, 'reserver')
    const coreAttackers = Overlord.getCreepsByRole(targetRoomName, 'coreAttacker')

    for (const miner of miners) {
        runRemoteMiner(miner, targetRoomName)
    }

    for (const hauler of haulers) {
        runRemoteHauler(hauler, room, targetRoomName)
    }

    for (const reserver of reservers) {
        runReserver(reserver, targetRoomName)
    }

    for (const coreAttacker of coreAttackers) {
        runCoreAttacker(coreAttacker, targetRoomName)
    }
}

function runRemoteMiner(creep, targetRoomName) {
    if (creep.spawning) {
        return
    }

    const hostileCreeps = creep.room.getEnemyCombatants()

    if (creep.pos.findInRange(hostileCreeps, 5).length > 0) {
        creep.fleeFrom(hostileCreeps, 15)
        return
    }

    if (creep.memory.getRecycled === true) {
        if (creep.room.name === creep.memory.base) {
            creep.getRecycled()
            return
        }
        const room = Game.rooms[creep.memory.base]
        if (!room) {
            creep.suicide()
            return
        }
        creep.moveToRoom(creep.memory.base)
        return
    }

    const targetRoom = Game.rooms[targetRoomName]

    if (!targetRoom) {
        creep.moveToRoom(targetRoomName)
        return
    }

    if (creep.memory.keeperLairId) {
        const keeperLair = Game.getObjectById(creep.memory.keeperLairId)
        if (keeperLair && keeperLair.ticksToSpawn < 15) {
            if (creep.pos.getRangeTo(keeperLair) <= 8) {
                creep.fleeFrom(keeperLair, 8)
                return
            }
        }
    }

    const source = Game.getObjectById(creep.memory.sourceId)
    const container = Game.getObjectById(creep.memory.containerId) || (source ? source.container : undefined)

    const target = container || source

    const range = container ? 0 : 1

    if (creep.pos.getRangeTo(target) > range) {
        creep.moveMy({ pos: target.pos, range })
        return
    }

    creep.setWorkingInfo(target.pos, range)

    creep.harvest(source)

    if (container && container.hits < 100000) {
        creep.repair(container)
    }
}

function runRemoteHauler(creep, base, targetRoomName) {
    if (creep.spawning) {
        return
    }

    const hostileCreeps = creep.room.getEnemyCombatants()

    if (creep.pos.findInRange(hostileCreeps, 5).length > 0) {
        creep.fleeFrom(hostileCreeps, 15)
        return
    }

    const targetRoom = Game.rooms[targetRoomName]

    if (!targetRoom) {
        creep.moveToRoom(targetRoomName)
        return
    }

    if (creep.memory.keeperLairId) {
        const keeperLair = Game.getObjectById(creep.memory.keeperLairId)
        if (keeperLair.ticksToSpawn < 15 && creep.pos.getRangeTo(keeperLair.pos) <= 8) {
            creep.fleeFrom(keeperLair, 8)
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
    if (creep.memory.supplying && creep.store[RESOURCE_ENERGY] === 0) {
        if (creep.room.name === base.name && creep.ticksToLive < 2.2 * (creep.memory.sourcePathLength || 0)) {
            creep.memory.getRecycled = true
            return
        }
        creep.memory.supplying = false
    } else if (!creep.memory.supplying && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        const amount = creep.store.getUsedCapacity(RESOURCE_ENERGY)
        if (base) {
            base.addRemoteProfit(targetRoomName, amount)
        }
        creep.memory.supplying = true
    }

    // 행동
    if (creep.memory.supplying) {
        if (!base) {
            creep.suicide()
        }

        if (creep.room.name === base.name) {
            return
        }

        const constructionSites = creep.room.constructionSites

        if (constructionSites.length > 0 && creep.getActiveBodyparts(WORK) > 1) {
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
            return
        }


        const closeBrokenThings = creep.pos.findInRange(creep.room.structures.damaged, 1).filter(structure => structure.structureType === STRUCTURE_ROAD)
        if (closeBrokenThings.length) {
            creep.repair(closeBrokenThings[0])
        }

        const spawn = base.structures.spawn[0]
        if (spawn) {
            creep.moveMy({ pos: spawn.pos, range: 3 })
        }
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

    const source = Game.getObjectById(creep.memory.sourceId)

    if (!source) {
        creep.moveToRoom(creep.memory.targetRoomName)
        return
    }


    if (creep.room.name === targetRoomName) {
        const tombstone = creep.pos.findInRange(FIND_TOMBSTONES, 5).find(tombstone => tombstone.store[RESOURCE_ENERGY] >= 50)

        if (tombstone) {
            creep.getEnergyFrom(tombstone.id)
            return
        }

        const droppedEnergy = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 5).find(resource =>
            resource.resourceType === RESOURCE_ENERGY && resource.amount >= 50)

        if (droppedEnergy) {
            creep.getEnergyFrom(droppedEnergy.id)
            return
        }
    }

    if (creep.pos.getRangeTo(source.pos) > 2) {
        creep.moveMy({ pos: source.pos, range: 2 })
        return
    }

    const energyThreshold = Math.min(creep.store.getFreeCapacity(), 500)

    const container = source.pos.findInRange(FIND_STRUCTURES, 1).find(structure => structure.store && structure.store[RESOURCE_ENERGY] >= energyThreshold)

    if (container) {
        creep.getEnergyFrom(container.id)
        return
    }

    const closeBrokenThings = creep.pos.findInRange(creep.room.structures.damaged, 3).filter(structure => structure.structureType === STRUCTURE_ROAD)
    if (closeBrokenThings.length) {
        creep.repair(closeBrokenThings[0])
    }

    creep.setWorkingInfo(source.pos, 2)
    return
}

function runReserver(creep, targetRoomName) {
    if (creep.spawning) {
        return
    }

    if (creep.memory.getRecycled === true) {
        if (creep.room.name === creep.memory.base) {
            creep.getRecycled()
            return
        }
        const room = Game.rooms[creep.memory.base]
        if (!room) {
            creep.suicide()
            return
        }
        creep.moveToRoom(creep.memory.base)
        return
    }

    const hostileCreeps = creep.room.getEnemyCombatants()

    if (creep.pos.findInRange(hostileCreeps, 5).length > 0) {
        creep.fleeFrom(hostileCreeps, 15)
        return
    }

    const targetRoom = Game.rooms[targetRoomName]

    if (!targetRoom) {
        creep.moveToRoom(targetRoomName)
        return
    }

    const controller = targetRoom ? targetRoom.controller : undefined

    if (creep.pos.getRangeTo(controller.pos) > 1) {
        const targetPos = controller.pos.getAtRange(1).find(pos => pos.walkable && (!pos.creep || (pos.creep.my && pos.creep.memory.role !== creep.memory.role)))
        if (!targetPos) {
            if (creep.pos.getRangeTo(controller.pos) > 3) {
                creep.moveMy({ pos: controller.pos, range: 3 })
            }
            return
        }
        creep.moveMy({ pos: targetPos, range: 0 })
        return
    }

    if (!controller.sign || controller.sign.username !== creep.owner.username) {
        creep.signController(controller, "A creep can do what he wants, but not want what he wants.")
    }

    creep.setWorkingInfo(controller.pos, 1)

    // if reserved, attack controller
    if (controller.reservation && controller.reservation.username !== MY_NAME) {
        creep.attackController(controller)
        return
    }

    creep.reserveController(controller)
    return
}

function runCoreAttacker(creep, targetRoomName) {
    if (creep.room.name !== targetRoomName) {
        creep.moveToRoom(targetRoomName, 1)
        return
    }

    const hostileCreeps = creep.room.findHostileCreeps().filter(creep => creep.checkBodyParts(INVADER_BODY_PARTS))
    if (hostileCreeps.length) {
        const target = creep.pos.findClosestByPath(hostileCreeps)
        if (target) {
            const range = creep.pos.getRangeTo(target)
            if (range <= 1) {
                creep.attack(target)
            }
            creep.moveMy({ pos: target.pos, range: 0 })
            return
        }
    }

    const targetCore = creep.pos.findClosestByPath(creep.room.find(FIND_HOSTILE_STRUCTURES))
    if (targetCore) {
        if (creep.pos.getRangeTo(targetCore) > 1) {
            creep.moveMy({ pos: targetCore.pos, range: 1 })
            return
        }
        creep.attack(targetCore)
        return
    }

    const center = new RoomPosition(25, 25, targetRoomName)
    if (creep.pos.getRangeTo(center) > 23) {
        creep.moveMy({ pos: center, range: 23 })
    }
}

function runAway(creep, roomName) {
    const hostileCreeps = creep.room.getEnemyCombatants()

    if (creep.pos.findInRange(hostileCreeps, 5).length > 0) {
        creep.fleeFrom(hostileCreeps, 15, 2)
        return
    }

    if (creep.memory.keeperLairId) {
        const keeperLair = Game.getObjectById(creep.memory.keeperLairId)
        if (keeperLair && keeperLair.ticksToSpawn < 15 && creep.pos.getRangeTo(keeperLair.pos) < 8) {
            creep.fleeFrom(keeperLair, 8)
            return
        }
    }

    if (hostileCreeps.length > 0 || isEdgeCoord(creep.pos.x, creep.pos.y)) {
        creep.moveToRoom(roomName)
    }
}

// invaderCore 추가하기
function spawnRemoteWorkers(room, targetRoomNames) {
    const reserve = room.energyCapacityAvailable >= 650

    const maxWork = reserve ? 6 : 3

    for (const targetRoomName of targetRoomNames) {
        const memory = getRoomMemory(targetRoomName)

        if (memory.invaderCore) {
            const coreAttackers = Overlord.getCreepsByRole(targetRoomName, 'coreAttacker')
            if (coreAttackers.length === 0) {
                room.requestCoreAttacker(targetRoomName)
                return
            }
        }

        const blueprint = getRemoteBlueprint(room, targetRoomName)

        const remoteInfo = room.getRemoteInfo(targetRoomName)

        const targetRoom = Game.rooms[targetRoomName]

        const reservationTick = getReservationTick(targetRoomName)

        if (reserve && reservationTick < 1000) {
            const reservers = Overlord.getCreepsByRole(targetRoomName, 'reserver')
            const numClaimParts = reservers.map(creep => creep.getActiveBodyparts('claim')).reduce((a, b) => a + b, 0)

            if (numClaimParts < 3 && reservers.length < (remoteInfo.controllerAvailable || 3)) {
                room.requestReserver(targetRoomName)
                return
            }
        }

        if (reservationTick < 0) {
            continue
        }

        const miners = Overlord.getCreepsByRole(targetRoomName, 'remoteMiner').filter(creep => {
            if (creep.spawning) {
                return true
            }
            return creep.ticksToLive > (creep.body.length * CREEP_SPAWN_TIME + 50)
        })

        const haulers = Overlord.getCreepsByRole(targetRoomName, 'remoteHauler').filter(creep => {
            if (creep.spawning) {
                return true
            }
            return creep.ticksToLive > (creep.body.length * CREEP_SPAWN_TIME)
        })

        const sourceStat = {}

        for (const info of blueprint) {
            const sourceId = info.sourceId
            sourceStat[sourceId] = { work: 0, numMiner: 0, carry: 0, repair: 0 }
        }

        for (const miner of miners) {
            const sourceId = miner.memory.sourceId
            sourceStat[sourceId].work += miner.getActiveBodyparts(WORK)
            sourceStat[sourceId].numMiner++
        }

        for (const haluer of haulers) {
            const sourceId = haluer.memory.sourceId
            sourceStat[sourceId].carry += haluer.getActiveBodyparts(CARRY)
            sourceStat[sourceId].repair += haluer.getActiveBodyparts(WORK)
        }

        const constructionComplete = !!remoteInfo.constructionComplete
        const constructionSites = targetRoom ? targetRoom.constructionSites : []

        for (const info of blueprint) {
            const sourceId = info.sourceId
            const stat = sourceStat[sourceId]

            if (stat.work < maxWork && stat.numMiner < info.available) {
                let containerId = undefined
                if (Game.getObjectById(info.containerId)) {
                    containerId = info.containerId
                } else if (targetRoom) {
                    const containerPacked = info.structures.find(packed => {
                        const parsed = unpackInfraPos(packed)
                        return parsed.structureType === 'container'
                    })
                    const containerUnpacked = unpackInfraPos(containerPacked)
                    const container = containerUnpacked.pos.lookFor(LOOK_STRUCTURES).find(structure => structure.structureType === 'container')
                    if (container) {
                        containerId = info.containerId = container.id
                    }
                }

                room.requestRemoteMiner(targetRoomName, sourceId, { containerId })
                return
            }

            const constructing = constructionSites.length > 0

            if (constructing && stat.repair < 6) {
                room.requestRemoteHauler(targetRoomName, sourceId, { constructing })
                return
            }

            const maxCarry = reserve ? info.maxCarry : info.maxCarry / 2

            if (!constructing && stat.carry < maxCarry) {
                const sourcePathLength = info.pathLength

                const maxHaulerCarry = constructionComplete
                    ? 2 * Math.min(Math.floor((this.energyCapacityAvailable - 150) / 150), 16) // with road
                    : Math.min(Math.floor(this.energyCapacityAvailable / 100), 25) // without road

                const maxNumHauler = Math.ceil(maxCarry / maxHaulerCarry)

                const eachCarry = Math.ceil(maxCarry / maxNumHauler)

                const isRepairer = stat.repair < 2

                room.requestRemoteHauler(targetRoomName, sourceId, { constructing, sourcePathLength, maxCarry: eachCarry, noRoad: !constructionComplete, isRepairer, })
                return
            }
        }
    }
}

Room.prototype.requestRemoteHauler = function (targetRoomName, sourceId, options = {}) {
    if (!this.hasAvailableSpawn()) {
        return
    }

    const body = []
    let cost = 0

    if (options.constructing) {
        for (let i = 0; i < Math.min(Math.floor(this.energyCapacityAvailable / 550), 3); i++) {
            body.push(WORK, WORK, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE)
            cost += 550
        }
    } else if (options.noRoad) {
        const energyCapacity = this.energyCapacityAvailable

        const maxCarry = options.maxCarry || 25

        for (let i = 0; i < Math.min(Math.floor(energyCapacity / 100), maxCarry); i++) {
            body.push(CARRY, MOVE)
            cost += 100
        }
    } else {

        if (options.isRepairer) {
            body.push(WORK, MOVE)
            cost += 150
        }

        const energyCapacity = this.energyCapacityAvailable - (options.isRepairer ? 150 : 0)

        const maxCarry = options.maxCarry || 32

        for (let i = 0; i < Math.min(Math.floor(energyCapacity / 150), Math.ceil(maxCarry / 2)); i++) {
            body.push(CARRY, CARRY, MOVE)
            cost += 150
        }
    }

    const name = `${targetRoomName} remoteHauler ${Game.time}_${this.spawnQueue.length}`
    const memory = {
        role: 'remoteHauler',
        base: this.name,
        targetRoomName,
        sourceId: sourceId,
    }

    const spawnOptions = {}
    spawnOptions.priority = SPAWN_PRIORITY['remoteHauler']
    spawnOptions.cost = cost

    if (options.isRepairer) {
        memory.isRepairer = true
    }

    if (options.sourcePathLength) {
        memory.sourcePathLength = options.sourcePathLength
    }

    if (options.keeperLairId) {
        memory.keeperLairId = options.keeperLairId
    }

    const request = new RequestSpawn(body, name, memory, spawnOptions)
    this.spawnQueue.push(request)
}

Room.prototype.requestRemoteMiner = function (targetRoomName, sourceId, options = {}) {
    if (!this.hasAvailableSpawn()) {
        return
    }

    let cost = 0
    let body = undefined

    if (options.sourceKeeper) {
        body = parseBody('8w5m1w1c')
        cost = 1200
    } else {
        const numWork = Math.min(Math.floor((this.energyCapacityAvailable) / 150), 6)

        body = parseBody(`${numWork}w${numWork}m`)
        cost += numWork * 150

        if ((this.energyCapacityAvailable - cost) >= 50) {
            body.push(CARRY)
            cost += 50
        }
    }

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

Room.prototype.requestCoreAttacker = function (targetRoomName) {
    if (!this.hasAvailableSpawn()) {
        return
    }

    let body = []
    let cost = 0
    const bodyLength = Math.min(Math.floor((this.energyCapacityAvailable) / 130), 25)
    for (let i = 0; i < bodyLength; i++) {
        body.push(ATTACK)
        cost += 80
    }
    for (let i = 0; i < bodyLength; i++) {
        body.push(MOVE)
        cost += 50
    }

    const name = `${targetRoomName} coreAttacker ${Game.time}_${this.spawnQueue.length}`
    const memory = {
        role: 'coreAttacker',
        base: this.name,
        targetRoomName,
    }
    const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['coreAttacker'], cost: cost })
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

function manageInvasion(room, targetRoomName) {
    const miners = Overlord.getCreepsByRole(targetRoomName, 'remoteMiner')
    const haulers = Overlord.getCreepsByRole(targetRoomName, 'remoteHauler')
    const reservers = Overlord.getCreepsByRole(targetRoomName, 'reserver')

    for (const worker of [...miners, ...haulers, ...reservers]) {
        runAway(worker, room.name)
    }
}

function getAllRemoteRoadPositions(room) {
    const result = []
    for (const targetRoomName of room.getRemoteNames()) {
        const remoteInfo = room.getRemoteInfo(targetRoomName)
        if (!remoteInfo) {
            continue
        }
        const blueprint = remoteInfo.blueprint
        if (!blueprint) {
            continue
        }

        for (const info of blueprint) {
            const packedStructures = info.structures
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

function constructRemote(room, targetRoomName) {
    const targetRoom = Game.rooms[targetRoomName]
    if (!room || !targetRoom) {
        return
    }

    if (Math.random() < 0.9) {
        return
    }

    const remoteInfo = room.getRemoteInfo(targetRoomName)

    remoteInfo.constructionComplete = remoteInfo.constructionComplete || false

    const blueprint = getRemoteBlueprint(room, targetRoomName)

    let complete = true

    for (const info of blueprint) {
        const packedStructures = info.structures
        let numConstructionSites = 0
        for (const packedStructure of packedStructures) {
            if (numConstructionSites >= 3) {
                break
            }

            const parsed = unpackInfraPos(packedStructure)
            const pos = parsed.pos

            if (!Game.rooms[pos.roomName]) {
                complete = false
                continue
            }

            if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0) {
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
        remoteInfo.constructionComplete = complete
        remoteInfo.constructionCompleteTime = Game.time
    }
}

function getRemoteValue(room, targetRoomName) {
    const remoteInfo = room.getRemoteInfo(targetRoomName)

    if (remoteInfo && remoteInfo.remoteValue) {
        return remoteInfo.remoteValue
    }

    const road = room.energyCapacityAvailable >= 650
    const reserve = room.energyCapacityAvailable >= 650

    let result = 0

    const blueprint = getRemoteBlueprint(room, targetRoomName)

    if (!blueprint) {
        console.log(`${room.name} cannot get blueprint of ${targetRoomName}`)
        return 0
    }

    for (const info of blueprint) {
        const income = reserve ? 10 : 5
        const distance = info.pathLength

        const minerCost = (950 / (1500 - distance))
        const haluerCost = (distance * HAULER_RATIO * (road ? 75 : 100) + 100) / 1500
        const creepCost = (minerCost + haluerCost) * (reserve ? 1 : 0.5)

        const containerCost = road ? 0.5 : 0
        const roadCost = road ? (1.6 * distance + 10 * distance / (1500 - distance) + 1.5 * distance / (600 - distance)) * 0.001 : 0

        const totalCost = creepCost + containerCost + roadCost

        const netIncome = income - totalCost

        result += netIncome
    }

    if (remoteInfo) {
        remoteInfo.remoteValue = result
    }

    return result
}

function getRemoteBlueprint(room, targetRoomName) {
    const remoteInfo = room.getRemoteInfo(targetRoomName)
    if (remoteInfo && remoteInfo.blueprint) {
        return remoteInfo.blueprint
    }

    const roomNameInCharge = room.name

    const startingPoint = room.storage || room.structures.spawn[0]
    if (!startingPoint) {
        return
    }

    const targetRoom = Game.rooms[targetRoomName]
    if (!targetRoom) {
        return
    }

    const result = []

    const sources = targetRoom.find(FIND_SOURCES)
    const roadPositions = [...getAllRemoteRoadPositions(room)]
    const basePlan = room.basePlan

    const remoteNames = room.getRemoteNames()

    const intermediates = new Set()

    for (const source of sources) {
        const search = PathFinder.search(source.pos, { pos: startingPoint.pos, range: 1 }, {
            plainCost: 5,
            swampCost: 6, // swampCost higher since road is more expensive on swamp
            maxOps: 20000,
            roomCallback: function (roomName) {
                if (![roomNameInCharge, targetRoomName, ...remoteNames].includes(roomName)) {
                    return false
                }

                const costs = new PathFinder.CostMatrix;

                for (const pos of roadPositions) {
                    if (pos.roomName === roomName) {
                        costs.set(pos.x, pos.y, 2)
                    }
                }

                const currentRoom = Game.rooms[roomName];
                if (!currentRoom) {
                    return costs;
                }

                currentRoom.find(FIND_STRUCTURES).forEach(function (structure) {
                    if (structure.structureType === STRUCTURE_ROAD) {
                        costs.set(structure.pos.x, structure.pos.y, 3)
                        return
                    }

                    if (structure.structureType === STRUCTURE_CONTAINER) {
                        costs.set(structure.pos.x, structure.pos.y, 50)
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

                if (roomName === roomNameInCharge && basePlan) {
                    for (let i = 1; i <= 8; i++) {
                        for (const structure of basePlan[`lv${i}`]) {
                            if (structure.structureType === STRUCTURE_ROAD) {
                                costs.set(structure.pos.x, structure.pos.y, 2)
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
            console.log(`${room.name} cannot find path to ${targetRoomName}`)
            continue
        }

        const path = search.path
        const pathLength = path.length

        if (pathLength > MAX_DISTANCE) {
            console.log(`${room.name} is too far to ${targetRoomName}`)
            continue
        }

        visualizePath(path)

        roadPositions.push(...path)

        const info = {}

        info.sourceId = source.id

        info.available = source.available

        info.pathLength = pathLength

        info.maxCarry = Math.floor(path.length * HAULER_RATIO)

        const structures = []

        const containerPos = path.shift()

        structures.push(containerPos.packInfraPos('container'))

        for (const pos of path) {
            const roomName = pos.roomName
            if (![roomNameInCharge, targetRoomName].includes(roomName)) {
                intermediates.add(roomName)
            }
            structures.push(pos.packInfraPos('road'))
        }

        info.structures = structures

        result.push(info)
    }

    if (result.length === 0) {
        return
    }

    result.sort((a, b) => a.pathLength - b.pathLength)

    if (remoteInfo) {
        if (intermediates.size > 0) {
            remoteInfo.intermediates = Array.from(intermediates)
        }

        remoteInfo.blueprint = result
        remoteInfo.controllerAvailable = targetRoom.controller.pos.available
    }


    return result
}

Room.prototype.getRemoteSpawnUsage = function (targetRoomName) {
    let result = 0

    const reserve = this.energyCapacityAvailable >= 650

    const blueprint = getRemoteBlueprint(this, targetRoomName)

    if (!blueprint) {
        return 0
    }

    for (const info of blueprint) {
        if (this.controller.level < 8) {
            result += 3 * 6 // upgrader. assume that income is 6e/tick
        }
        result += 13 // miner
        result += Math.floor(info.maxCarry * (reserve ? 1.5 : 2)) // hauler
    }

    if (!reserve) {
        result = result * 0.5
    } else if (result > 0) {
        result += 5 // reserver. 2/tick
    }

    return Math.ceil(result)
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

module.exports = {
    MAX_DISTANCE,
    HAULER_RATIO,
    runRemoteMiner,
    runRemoteHauler,
    runAway,
    unpackInfraPos,
    getRemoteValue,
    getRemoteBlueprint,
}
const { GuardRequest, getCombatInfo } = require("./overlord_tasks_guard")
const { getRoomMemory } = require("./util")

const MAX_DISTANCE = 140

const HAULER_RATIO = 0.4

const RESERVATION_TICK_THRESHOLD = 1000

const SOURCE_KEEPER_RANGE_TO_START_FLEE = 7

const SOURCE_KEEPER_RANGE_TO_FLEE = 6

const KEEPER_LAIR_RANGE_TO_START_FLEE = 9

const KEEPER_LAIR_RANGE_TO_FLEE = 8

Room.prototype.manageRemotes = function () {
    const remoteNames = this.getRemoteNames().sort((a, b) => getRemoteValue(this, b) - getRemoteValue(this, a))
    const activeRemoteNames = this.getActiveRemoteNames()
    const remoteNamesToSpawn = []

    const invaderStrengthThreshold = getInvaderStrengthThreshold(this.controller.level) // 1에서 100, 8에서 1644정도

    const canReserve = this.energyCapacityAvailable >= 650

    let remoteNameToConstruct = undefined

    let priority = 1

    this.heap.numIdlingRemoteHaulerCarryParts = 0
    this.heap.numRemoteHaulerCarryParts = 0
    for (const targetRoomName of remoteNames) {

        if (!activeRemoteNames.includes(targetRoomName)) {
            runRemoteWorkers(this, targetRoomName)
            continue
        }

        Game.map.visual.text(priority, new RoomPosition(25, 25, targetRoomName), { fontSize: 5, backgroundColor: '#000000', opacity: 1 })
        priority++

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
            const leftTicks = memory.combatantsTicksToLive - Game.time
            Game.map.visual.text(`👿${leftTicks}`, new RoomPosition(49, 5, targetRoomName), { fontSize: 5, align: 'right' })
            if (leftTicks <= 0) {
                delete memory.isCombatant
                delete memory.invader
                delete memory.combatantsTicksToLive
            }
            manageInvasion(this, targetRoomName)
            continue
        }

        runRemoteWorkers(this, targetRoomName)

        if (canReserve && !remoteNameToConstruct && (!info.constructionComplete || Game.time > (info.constructionCompleteTime + 3000))) {
            remoteNameToConstruct = targetRoomName
        }

        remoteNamesToSpawn.push(targetRoomName)
    }

    const idlingPercentage = this.heap.numRemoteHaulerCarryParts ? Math.floor((this.heap.numIdlingRemoteHaulerCarryParts / this.heap.numRemoteHaulerCarryParts) * 10000) / 100 : 0

    Game.map.visual.text(`😴${idlingPercentage}%`, new RoomPosition(25, 45, this.name), { fontSize: 5, backgroundColor: `#000000`, opacity: 1 })
    Game.map.visual.text(`${this.heap.numRemoteHaulerCarryParts}`, new RoomPosition(25, 35, this.name), { fontSize: 5, backgroundColor: `#000000`, opacity: 1 })


    if (remoteNameToConstruct) {
        constructRemote(this, remoteNameToConstruct)
    }

    if (this.memory.militaryThreat) {
        return
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

    delete this.memory.activeRemotes
}

Room.prototype.deleteRemote = function (targetRoomName) {
    this.memory.remotes = this.memory.remotes || {}
    delete this.memory.remotes[targetRoomName]

    const memory = getRoomMemory(targetRoomName)
    delete memory.roomNameInCharge

    delete this.memory.activeRemotes
}

Room.prototype.getActiveRemoteNames = function () {
    const activeRemotes = this.getActiveRemotes()
    return activeRemotes.map(info => info.remoteName)
}

Room.prototype.getActiveRemotes = function () {
    if (this.memory.activeRemotes && this.memory.activeRemotesTime && (Game.time < this.memory.activeRemotesTime + 20)) {
        return this.memory.activeRemotes
    }

    const remoteInfos = []

    for (const remoteName of this.getRemoteNames()) {
        const memory = this.getRemoteInfo(remoteName)
        if (!memory) {
            continue
        }
        if (memory.forbiddn) {
            continue
        }

        // basic

        const value = getRemoteValue(this, remoteName)
        const weight = Math.ceil(this.getRemoteSpawnUsage(remoteName))
        const intermediate = memory.intermediates

        const info = { remoteName, intermediate, value, weight, oneSource: false }

        remoteInfos.push(info)

        const blueprint = getRemoteBlueprint(this, remoteName)

        if (blueprint.length <= 1) {
            continue
        }

        // oneSource
        const value2 = getRemoteValue(this, remoteName, true)
        const weight2 = Math.ceil(this.getRemoteSpawnUsage(remoteName, true))

        const info2 = { remoteName, intermediate, value: value2, weight: weight2, oneSource: true }

        remoteInfos.push(info2)
    }

    let spawnCapacityForRemotes = Math.floor(this.structures.spawn.length * 500 - this.getBasicSpawnCapacity())

    if (spawnCapacityForRemotes < 0) {
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
        const w = info.weight
        const v = info.value
        const intermediateNames = info.intermediate
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

    // 1 unit with alpha = 0.2
    // recent unit is weighted by 0.2
    // previous unit is wighted by 0.2 * 0.8
    const alpha = 0.2

    if (interval >= CREEP_LIFE_TIME) {
        if (remoteInfo.netIncomePerTick) {
            const modifiedAlpha = 1 - Math.pow(1 - alpha, interval / CREEP_LIFE_TIME)
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
        if (creep.pos.findInRange(hostileCreeps, SOURCE_KEEPER_RANGE_TO_START_FLEE).length > 0) {
            creep.fleeFrom(hostileCreeps, SOURCE_KEEPER_RANGE_TO_FLEE)
            return
        }

        const keeperLair = Game.getObjectById(creep.memory.keeperLairId)
        if (keeperLair && keeperLair.ticksToSpawn < 15) {
            if (creep.pos.getRangeTo(keeperLair) <= KEEPER_LAIR_RANGE_TO_START_FLEE) {
                creep.fleeFrom(keeperLair, KEEPER_LAIR_RANGE_TO_FLEE)
                return
            }
        }
    } else {
        if (creep.pos.findInRange(hostileCreeps, 6).length > 0) {
            creep.fleeFrom(hostileCreeps, 30)
            return
        }
    }

    const source = Game.getObjectById(creep.memory.sourceId)
    const container = Game.getObjectById(creep.memory.containerId) || targetRoom.structures.container.find(structure => structure.pos.isNearTo(source))
    const isOtherCreep = container && container.pos.creep && container.pos.creep.memory && container.pos.creep.memory.role === creep.memory.role

    const target = (container && !isOtherCreep) ? container : source

    const range = (container && !isOtherCreep) ? 0 : 1

    if (creep.pos.getRangeTo(target) > range) {
        creep.moveMy({ pos: target.pos, range })
        return
    }

    creep.setWorkingInfo(target.pos, range)

    const harvestPower = creep.getActiveBodyparts(WORK) * HARVEST_POWER

    if (source instanceof Source) {
        const postponeHarvest = container && (container.store.getUsedCapacity() >= (CONTAINER_CAPACITY - harvestPower)) && Math.ceil(source.energy / harvestPower) < (source.ticksToRegeneration || 0)

        if (!postponeHarvest) {
            creep.harvest(source)
        }
    } else if (source instanceof Mineral) {
        creep.harvest(source)
    }

    if (creep.store[RESOURCE_ENERGY] > 0 && container && container.hits < 150000) {
        creep.repair(container)
    }
}

function runRemoteHauler(creep, base, targetRoomName) {
    base.heap.numRemoteHaulerCarryParts += creep.getActiveBodyparts(CARRY)
    if (creep.spawning) {
        return
    }

    const hostileCreeps = creep.room.getEnemyCombatants()

    if (creep.memory.keeperLairId) {
        if (creep.pos.findInRange(hostileCreeps, SOURCE_KEEPER_RANGE_TO_START_FLEE).length > 0) {
            creep.fleeFrom(hostileCreeps, SOURCE_KEEPER_RANGE_TO_FLEE)
            return
        }

        const keeperLair = Game.getObjectById(creep.memory.keeperLairId)
        if (keeperLair.ticksToSpawn < 15 && creep.pos.getRangeTo(keeperLair.pos) <= KEEPER_LAIR_RANGE_TO_START_FLEE) {
            creep.fleeFrom(keeperLair, KEEPER_LAIR_RANGE_TO_FLEE)
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
        if (creep.room.name === base.name && creep.ticksToLive < 2.2 * (creep.memory.sourcePathLength || 0)) {
            creep.memory.getRecycled = true
            return
        }
        creep.memory.supplying = false
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
            creep.suicide()
        }

        if (creep.room.name === base.name) {
            return
        }

        const constructionSites = creep.room.constructionSites

        if (constructionSites.length > 0 && creep.getActiveBodyparts(WORK) > 1 && creep.store.getUsedCapacity(RESOURCE_ENERGY)) {
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

        const tombstone = creep.pos.findInRange(FIND_TOMBSTONES, 6).find(tombstone => tombstone.store[RESOURCE_ENERGY] >= 50)

        if (tombstone) {
            creep.memory.targetId = tombstone.id
            creep.getEnergyFrom(tombstone.id)
            return
        }

        const droppedResource = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 6).find(resource => resource.amount >= 50)

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
    }

    if (creep.pos.getRangeTo(source.pos) > 2) {
        creep.moveMy({ pos: source.pos, range: 2 })
        return
    }

    base.heap.numIdlingRemoteHaulerCarryParts += creep.getActiveBodyparts(CARRY)
    Game.map.visual.text(`😴`, creep.pos, { fontSize: 5 })

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

    const targetCore = creep.room.find(FIND_HOSTILE_STRUCTURES).find(structure => structure.structureType === STRUCTURE_INVADER_CORE)
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

// invaderCore 추가하기
function spawnRemoteWorkers(room, targetRoomNames) {
    room.memory.currentRemoteIncome = 0

    let requested = false

    const canReserve = room.energyCapacityAvailable >= 650

    const activeRemotes = room.getActiveRemotes()

    outer:
    for (const targetRoomName of targetRoomNames) {
        const oneSource = activeRemotes.find(info => info.remoteName === targetRoomName).oneSource

        const blueprint = getRemoteBlueprint(room, targetRoomName)

        if (!blueprint) {
            continue
        }

        const reservationTick = getReservationTick(targetRoomName)
        Game.map.visual.text(`⏰${reservationTick}`, new RoomPosition(49, 45, targetRoomName), { fontSize: 5, align: 'right' })

        const remoteInfo = room.getRemoteInfo(targetRoomName)

        if (reservationTick < 0) {
            if (canReserve) {
                const reservers = Overlord.getCreepsByRole(targetRoomName, 'reserver')
                const numClaimParts = reservers.map(creep => creep.getActiveBodyparts('claim')).reduce((a, b) => a + b, 0)

                if (numClaimParts < 2 && reservers.length < (remoteInfo.controllerAvailable || 2)) {
                    room.requestReserver(targetRoomName)
                    requested = true
                    continue outer
                }
            }
            continue
        }

        const maxWork = canReserve ? 5 : 3

        const sourceStat = {}

        for (const info of blueprint) {
            const sourceId = info.sourceId
            sourceStat[sourceId] = { numMiner: 0, numHauler: 0, work: 0, carry: 0, repair: 0, pathLength: info.pathLength, maxCarry: Math.ceil(info.maxCarry * (canReserve ? 1 : 0.3)), maxWork }
        }
        // If you cannot reserve, 2.5 e/tick + no container, so it decays 1e/tick. So it becomes 1.5e / tick. which is 0.3 of 5e/tick

        const targetRoom = Game.rooms[targetRoomName]

        const miners = Overlord.getCreepsByRole(targetRoomName, 'remoteMiner').filter(creep => {
            if (creep.spawning) {
                return true
            }
            const pathLength = sourceStat[creep.memory.sourceId].pathLength
            return creep.ticksToLive > (creep.body.length * CREEP_SPAWN_TIME + pathLength)
        })

        const haulers = Overlord.getCreepsByRole(targetRoomName, 'remoteHauler').filter(creep => {
            if (creep.spawning) {
                return true
            }
            if (creep.memory.getRecycled) {
                return false
            }
            return creep.ticksToLive > (creep.body.length * CREEP_SPAWN_TIME)
        })

        for (const miner of miners) {
            const sourceId = miner.memory.sourceId
            sourceStat[sourceId].work += miner.getActiveBodyparts(WORK)
            sourceStat[sourceId].numMiner++
        }

        for (const haluer of haulers) {
            const sourceId = haluer.memory.sourceId
            sourceStat[sourceId].carry += haluer.getActiveBodyparts(CARRY)
            sourceStat[sourceId].repair += haluer.getActiveBodyparts(WORK)
            sourceStat[sourceId].numHauler++
        }

        remoteInfo.sourceStat = sourceStat

        const constructionComplete = !!remoteInfo.constructionComplete
        const constructionSites = targetRoom ? targetRoom.constructionSites : []
        const constructing = constructionSites.length > 0

        if (!constructing) {
            const utilizationRates = Object.values(sourceStat).map(stat => Math.min((stat.carry / stat.maxCarry), (stat.work / maxWork)))
            const utilizationRate = utilizationRates.reduce((acc, curr) => acc + curr, 0) / utilizationRates.length
            room.memory.currentRemoteIncome += getRemoteValue(room, targetRoomName) * utilizationRate
        }

        let x = 10
        for (const sourceId of Object.keys(sourceStat)) {
            const stat = sourceStat[sourceId]
            const fontSize = 4
            const opacity = 1
            const black = '#000000'
            Game.map.visual.text(`⛏️${stat.work}/${maxWork}`, new RoomPosition(x, 20, targetRoomName), { fontSize, backgroundColor: stat.work >= maxWork ? black : COLOR_NEON_RED, opacity })
            Game.map.visual.text(`🚚${stat.carry}/${stat.maxCarry} `, new RoomPosition(x, 25, targetRoomName), { fontSize, backgroundColor: stat.carry >= stat.maxCarry ? black : COLOR_NEON_RED, opacity })
            const source = Game.getObjectById(sourceId)
            if (source) {
                const amountNear = source.energyAmountNear
                Game.map.visual.text(`🔋${amountNear}/2000 `, new RoomPosition(x, 30, targetRoomName), { fontSize, backgroundColor: amountNear < 2000 ? black : COLOR_NEON_RED, opacity })
            }
            x += 30

            if (oneSource) {
                break
            }
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

            if (numClaimParts < 2 && reservers.length < (remoteInfo.controllerAvailable || 2)) {
                room.requestReserver(targetRoomName)
                requested = true
                continue outer
            }
        }

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
                room.requestRemoteMiner(targetRoomName, sourceId, { containerId, maxWork: maxWork === 5 ? 6 : maxWork, needCarry: canReserve })
                requested = true
                continue outer
            }

            let maxCarry = stat.maxCarry

            if (constructing && stat.carry < maxCarry && stat.repair < 6) {
                room.requestRemoteHauler(targetRoomName, sourceId, { constructing })
                requested = true
                continue outer
            }

            const energyCapacity = Math.max(room.energyCapacityAvailable * 0.8, 300)

            const maxHaulerCarry = constructionComplete
                ? 2 * Math.min(Math.floor((energyCapacity - 150) / 150), 16) // with road
                : Math.min(Math.floor(energyCapacity / 100), 25) // without road

            if (!constructing && stat.carry < maxCarry) {
                const sourcePathLength = info.pathLength

                const maxNumHauler = Math.ceil(maxCarry / maxHaulerCarry)

                if (stat.numHauler < maxNumHauler) {
                    const eachCarry = Math.min(maxHaulerCarry, Math.ceil(maxCarry / maxNumHauler))

                    const numCarry = stat.numHauler < maxNumHauler - 1 ? eachCarry : Math.min(eachCarry, maxCarry - stat.carry, maxHaulerCarry)

                    const isRepairer = stat.repair < 2

                    room.requestRemoteHauler(targetRoomName, sourceId, { constructing, sourcePathLength, maxCarry: numCarry, noRoad: !constructionComplete, isRepairer, })
                    requested = true
                    continue outer
                }
            }

            if (oneSource) {
                break
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


    const name = `${targetRoomName} remoteHauler ${Game.time}_${this.spawnQueue.length}`
    const memory = {
        role: 'remoteHauler',
        base: this.name,
        targetRoomName,
        sourceId: sourceId,
    }

    if (options.constructing) {
        for (let i = 0; i < Math.min(Math.floor(this.energyCapacityAvailable / 550), 3); i++) {
            body.push(WORK, WORK, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE)
            cost += 550
        }

        memory.useRoad = true
    } else if (options.noRoad) {
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

        if (options.isRepairer) {
            body.push(WORK, MOVE)
            cost += 150
        }

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

        if (work > 5 && carry < 1 && energyCapacity >= cost + BODYPART_COST[CARRY]) {
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

    const activeRemotes = room.getActiveRemotes()

    const oneSource = activeRemotes.find(info => info.remoteName === targetRoomName).oneSource

    const remoteInfo = room.getRemoteInfo(targetRoomName)

    remoteInfo.constructionComplete = remoteInfo.constructionComplete || false

    const blueprint = getRemoteBlueprint(room, targetRoomName)

    let complete = true

    for (const info of blueprint) {
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

        if (oneSource) {
            break
        }
    }

    if (complete) {
        remoteInfo.constructionComplete = complete
        remoteInfo.constructionCompleteTime = Game.time
    }
}

function getRemoteValue(room, targetRoomName, oneSource = false) {
    const remoteInfo = room.getRemoteInfo(targetRoomName)

    const canReserve = room.energyCapacityAvailable >= 650

    if (remoteInfo && remoteInfo.remoteValue && remoteInfo.remoteValueTime && (!!remoteInfo.oneSource === oneSource) && (!!remoteInfo.canReserve === canReserve)) {
        return remoteInfo.remoteValue
    }

    let result = 0

    const blueprint = getRemoteBlueprint(room, targetRoomName)

    if (!blueprint) {
        console.log(`${room.name} cannot get blueprint of ${targetRoomName}`)
        return 0
    }

    for (const info of blueprint) {
        const income = canReserve ? 10 : 5
        const distance = info.pathLength

        const minerCost = (950 / (1500 - distance))
        const haluerCost = (distance * HAULER_RATIO * (canReserve ? 75 : 100) + 100) / 1500
        const creepCost = (minerCost + haluerCost) * (canReserve ? 1 : 0.5)

        const containerCost = canReserve ? 0.5 : 0
        const roadCost = canReserve ? (1.6 * distance + 10 * distance / (1500 - distance) + 1.5 * distance / (600 - distance)) * 0.001 : 0

        const totalCost = creepCost + containerCost + roadCost

        const netIncome = income - totalCost

        result += netIncome

        if (oneSource) {
            break
        }
    }

    if (remoteInfo) {
        remoteInfo.canReserve = canReserve
        remoteInfo.oneSource = oneSource
        remoteInfo.remoteValueTime = Game.time
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
            heuristicWeight: 1,
            roomCallback: function (roomName) {
                if (![roomNameInCharge, targetRoomName, ...remoteNames].includes(roomName)) {
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

        info.maxCarry = Math.ceil(path.length * HAULER_RATIO * 0.95 + 0.5)

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

Room.prototype.getRemoteSpawnUsage = function (targetRoomName, oneSource = false) {
    let result = 0

    const canReserve = this.energyCapacityAvailable >= 650

    const blueprint = getRemoteBlueprint(this, targetRoomName)

    if (!blueprint) {
        return 0
    }

    for (const info of blueprint) {
        if (this.controller.level < 8) {
            result += 3 * 5 // upgrader. assume that income is 5e/tick
        }
        result += 13 // miner
        result += Math.floor(info.maxCarry * (canReserve ? 1.5 : 2)) // hauler

        if (oneSource) {
            break
        }
    }

    if (!canReserve) {
        result = result * 0.5
    } else if (result > 0) {
        result += 5 // reserver. 1/tick
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
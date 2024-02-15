const { GuardRequest, getCombatInfo } = require("./overlord_tasks_guard")
const { MAX_DISTANCE, unpackInfraPos, runRemoteMiner, runRemoteHauler, runAway } = require("./room_manager_remote")
const { getRoomMemory } = require("./util")

const SK_HAULER_RATIO = 0.6
const SK_MINERAL_HAULER_RATIO = 0.2 + 0.1 + 0.2
// 0.2 for mineral, 0.1 for tombstone, 0.2 for mineral buffer

const sourceKeeperHandlerBody = parseBody(`25m18a5h1a1h`)

Room.prototype.manageSourceKeeperMining = function () {
  this.memory.activeSK = this.memory.activeSK || []
  for (const targetRoomName of this.memory.activeSK) {
    if (isStronghold(targetRoomName)) {
      continue
    }

    const targetRoom = Game.rooms[targetRoomName]
    Memory.rooms[targetRoomName] = Memory.rooms[targetRoomName] || {}
    const memory = Memory.rooms[targetRoomName]

    if (targetRoom) {
      const invaders = [...targetRoom.findHostileCreeps()].filter(creep => creep.owner.username !== 'Source Keeper')
      const enemyInfo = getCombatInfo(invaders)
      const isEnemy = invaders.some(creep => creep.checkBodyParts(INVADER_BODY_PARTS))

      if (!memory.invader && isEnemy) {
        memory.invader = true

        const request = new GuardRequest(this, targetRoomName, enemyInfo, { ignoreSourceKeepers: true })
        Overlord.registerTask(request)

      } else if (memory.invader && !isEnemy) {
        memory.invader = false
      }

      if (!memory.isCombatant && enemyInfo.strength > 0) {
        memory.isCombatant = true
      } else if (memory.isCombatant && enemyInfo.strength === 0) {
        memory.isCombatant = false
      }
    }

    if (memory.isCombatant) {
      manageInvasion(this, targetRoomName)
      continue
    }

    if (targetRoom && (!targetRoom.memory.constructionComplete || Game.time > (targetRoom.memory.constructionCompleteTime + 3000))) {
      constructSourceKeeperRoomInfra(this, targetRoomName)
    }

    manageSpawnSourceKeeperRoomWorkers(this, targetRoomName)

    manageSourceKeeperRoomWorkers(this, targetRoomName)
  }
}

// get remote net income per tick with EMA
Room.prototype.getSourceKeeperMiningNetIncomePerTick = function (targetRoomName) {
  const sourceKeeperMiningInfo = this.getSourceKeeperMiningInfo(targetRoomName)

  if (!sourceKeeperMiningInfo.startTick) {
    delete sourceKeeperMiningInfo.netIncome
  }

  sourceKeeperMiningInfo.startTick = sourceKeeperMiningInfo.startTick || Game.time
  sourceKeeperMiningInfo.lastTick = sourceKeeperMiningInfo.lastTick || Game.time
  const netIncome = sourceKeeperMiningInfo.netIncome || 0

  const interval = Game.time - sourceKeeperMiningInfo.lastTick

  // 1000 tick = 1 unit with alpha = 0.2
  // so, recent 1000 tick is weighted by 0.2
  // previous 1000 tick is wighted by 0.2 * 0.8
  const alpha = 0.2

  if (interval >= CREEP_LIFE_TIME) {
    if (sourceKeeperMiningInfo.netIncomePerTick) {
      const modifiedAlpha = 1 - Math.pow(1 - alpha, interval / CREEP_LIFE_TIME)
      sourceKeeperMiningInfo.netIncomePerTick = modifiedAlpha * (netIncome / interval) + (1 - modifiedAlpha) * sourceKeeperMiningInfo.netIncomePerTick
    } else {
      sourceKeeperMiningInfo.netIncomePerTick = netIncome / interval
    }
    sourceKeeperMiningInfo.lastTick = Game.time
    sourceKeeperMiningInfo.netIncome = 0
  }

  if (!sourceKeeperMiningInfo.netIncomePerTick) {
    return netIncome / interval
  }

  return sourceKeeperMiningInfo.netIncomePerTick
}

Room.prototype.getSourceKeeperMiningInfo = function (targetRoomName) {
  return getRoomMemory(targetRoomName)
}

function manageInvasion(room, targetRoomName) {
  const miners = Overlord.getCreepsByRole(targetRoomName, 'remoteMiner')
  const haulers = Overlord.getCreepsByRole(targetRoomName, 'remoteHauler')
  const sourceKeeperHandlers = Overlord.getCreepsByRole(targetRoomName, 'sourceKeeperHandler')

  for (const worker of [...miners, ...haulers, ...sourceKeeperHandlers]) {
    runAway(worker, room.name)
  }
}

function isStronghold(targetRoomName) {
  Memory.rooms[targetRoomName] = Memory.rooms[targetRoomName] || {}
  const memory = Memory.rooms[targetRoomName]
  const invaderCoreInfo = memory.invaderCore

  const targetRoom = Game.rooms[targetRoomName]

  if (!targetRoom) {
    if (invaderCoreInfo) {
      if (invaderCoreInfo.deployTime && Game.time < invaderCoreInfo.deployTime) {
        return false
      }

      if (invaderCoreInfo.ticksToCollapse && Game.time < invaderCoreInfo.ticksToCollapse) {
        Game.map.visual.text(invaderCoreInfo.ticksToCollapse - Game.time, new RoomPosition(40, 5, targetRoomName), { fontSize: 6 })
        return true
      }
    }
    return false
  }

  const invaderCore = targetRoom.find(FIND_HOSTILE_STRUCTURES).find(structure => structure.structureType === STRUCTURE_INVADER_CORE)
  if (!invaderCore) {
    delete memory.invaderCore
    return false
  }

  const info = {}

  info.level = invaderCore.level

  if (invaderCore.ticksToDeploy) {
    info.deployTime = Game.time + invaderCore.ticksToDeploy
    memory.invaderCore = info
    return false
  } else {
    const effects = invaderCore.effects
    for (const effectInfo of effects) {
      if (effectInfo.effect === EFFECT_COLLAPSE_TIMER) {
        info.ticksToCollapse = Game.time + effectInfo.ticksRemaining
        memory.invaderCore = info
        return true
      }
    }
  }
}

function constructSourceKeeperRoomInfra(room, targetRoomName) {
  const targetRoom = Game.rooms[targetRoomName]
  if (!room || !targetRoom) {
    return
  }

  if (Math.random() < 0.8) {
    return
  }

  targetRoom.memory.constructionComplete = targetRoom.memory.constructionComplete || false

  const infraPlan = getSourceKeeperRoomInfraPlan(room, targetRoomName)

  let complete = true

  for (const info of infraPlan) {
    if (info.isMineral) {
      continue
    }

    const packedStructures = info.infraPlan
    let numConstructionSites = 0
    for (const packedStructure of packedStructures) {
      const parsed = unpackInfraPos(packedStructure)
      const pos = parsed.pos

      if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0) {
        complete = false
        numConstructionSites++
      }
      const structureType = parsed.structureType

      if ([ERR_FULL, OK].includes(pos.createConstructionSite(structureType))) {
        complete = false
        numConstructionSites++
      }

      if (numConstructionSites >= 6) {
        break
      }
    }
  }

  targetRoom.memory.constructionComplete = complete

  if (complete) {
    targetRoom.memory.constructionCompleteTime = Game.time
  }
}

function manageSourceKeeperRoomWorkers(room, targetRoomName) {
  const miners = Overlord.getCreepsByRole(targetRoomName, 'remoteMiner')
  const haulers = Overlord.getCreepsByRole(targetRoomName, 'remoteHauler')
  const sourceKeeperHandlers = Overlord.getCreepsByRole(targetRoomName, 'sourceKeeperHandler')

  for (const miner of miners) {
    runRemoteMiner(miner, targetRoomName)
  }

  for (const hauler of haulers) {
    runRemoteHauler(hauler, room, targetRoomName)
  }

  for (const sourceKeeperHandler of sourceKeeperHandlers) {
    runSourceKeeperRoomHandler(sourceKeeperHandler, targetRoomName)
  }
}

function manageSpawnSourceKeeperRoomWorkers(room, targetRoomName) {
  const sourceKeeperHandlers = Overlord.getCreepsByRole(targetRoomName, 'sourceKeeperHandler')
  if (!sourceKeeperHandlers.find(creep => creep.ticksToLive > 200 || creep.spawning)) {
    room.requestSourceKeeperHandler(targetRoomName)
  }

  const infraPlan = getSourceKeeperRoomInfraPlan(room, targetRoomName)

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

  for (const info of infraPlan) {
    const sourceId = info.sourceId || info.mineralId
    sourceStat[sourceId] = sourceStat[sourceId] || {}
    const stat = sourceStat[sourceId]
    stat.maxWork = info.mineralId ? 32 : 12
    stat.work = 0
    stat.carry = 0
    stat.maxCarry = info.maxCarry
    stat.repair = 0
    stat.notMining = info.isMineral && !info.ongoing
  }

  for (const miner of miners) {
    const sourceId = miner.memory.sourceId
    sourceStat[sourceId].work += miner.getActiveBodyparts(WORK)
  }

  for (const haluer of haulers) {
    const sourceId = haluer.memory.sourceId
    sourceStat[sourceId].carry += haluer.getActiveBodyparts(CARRY)
    sourceStat[sourceId].repair += haluer.getActiveBodyparts(WORK)
  }

  const positions = [{ x: 10, y: 15 }, { x: 40, y: 15 }, { x: 10, y: 30 }, { x: 40, y: 30 }]
  let i = 0
  for (const sourceId of Object.keys(sourceStat)) {
    const x = positions[i].x
    const y = positions[i].y
    i++
    const stat = sourceStat[sourceId]
    if (stat.notMining) {
      continue
    }
    const fontSize = 4
    const opacity = 1
    const black = '#000000'
    Game.map.visual.text(`⛏️${stat.work}/${stat.maxWork}`, new RoomPosition(x, y, targetRoomName), { fontSize, backgroundColor: stat.work >= stat.maxWork ? black : COLOR_NEON_RED, opacity })
    Game.map.visual.text(`🚚${stat.carry}/${stat.maxCarry} `, new RoomPosition(x, y + 5, targetRoomName), { fontSize, backgroundColor: stat.carry >= stat.maxCarry ? black : COLOR_NEON_RED, opacity })
    const source = Game.getObjectById(sourceId)
    if (source && source instanceof Source) {
      const amountNear = source.energyAmountNear
      Game.map.visual.text(`🔋${amountNear}/2000 `, new RoomPosition(x, y + 10, targetRoomName), { fontSize, backgroundColor: amountNear < 2000 ? black : COLOR_NEON_RED, opacity })
    }
  }

  for (const info of infraPlan) {
    const sourceId = info.sourceId || info.mineralId
    const stat = sourceStat[sourceId]
    const keeperLairId = info.keeperLairId

    Memory.rooms[targetRoomName] = Memory.rooms[targetRoomName] || {}
    const constructing = !Memory.rooms[targetRoomName].constructionComplete

    const isMineral = info.isMineral

    if (isMineral) {
      const mineral = Game.getObjectById(info.mineralId)
      if (!mineral) {
        info.ongoing = false
        continue
      }

      const terminal = room.terminal
      if (!terminal || terminal.store.getFreeCapacity() < 50000) {
        info.ongoing = false
        continue
      }

      if (info.ongoing && mineral.ticksToRegeneration > 0) {
        info.ongoing = false
      } else if (!info.ongoing && !mineral.ticksToRegeneration) {
        info.ongoing = true
        Memory.rooms[targetRoomName].constructionComplete = false
        continue
      }
      if (!info.ongoing) {
        continue
      }
    }

    const maxWork = stat.maxWork

    if (stat.work < maxWork) {
      room.requestRemoteMiner(targetRoomName, sourceId, { maxWork, keeperLairId, sourceKeeper: true })
      return
    }

    if (constructing) {
      if (stat.repair < 12) {
        room.requestRemoteHauler(targetRoomName, sourceId, { constructing, keeperLairId })
        return
      }
    } else if (stat.carry < info.maxCarry) {
      const maxCarry = info.eachCarry
      const sourcePathLength = info.pathLength
      const isRepairer = isMineral ? false : stat.repair < 2
      const noRoad = isMineral
      room.requestRemoteHauler(targetRoomName, sourceId, { constructing, noRoad, keeperLairId, isRepairer, sourcePathLength, maxCarry })
      return
    }
  }
}

Room.prototype.checkSourceKeeperRoom = function (targetRoomName) {
  if (this.energyCapacityAvailable < 4270) { //energy to spawn SK handler
    return false
  }

  if (this.memory.activeSK && this.memory.activeSK.includes(targetRoomName)) { //already mining
    return false
  }

  const intel = Overlord.getIntel(targetRoomName)

  if (intel[scoutKeys.notForRemote] !== undefined && intel[scoutKeys.notForRemote].includes(this.name)) { // already failed
    return false
  }

  const adjacentRoomNames = Overlord.getAdjacentRoomNames(this.name)

  if (!adjacentRoomNames.includes(targetRoomName)) { // not adjacent
    return false
  }

  const infraPlan = getSourceKeeperRoomInfraPlan(this, targetRoomName)

  if (!infraPlan) { //no infra. cache failure and return false.
    intel[scoutKeys.notForRemote] = intel[scoutKeys.notForRemote] || []
    intel[scoutKeys.notForRemote].push(this.name)
    return false
  }

  let pathLengthSum = 0

  for (const info of infraPlan) {
    pathLengthSum += info.pathLength
  }

  const pathLengthAverage = pathLengthSum / infraPlan.length

  if (pathLengthAverage > MAX_DISTANCE) {//too far. cache failure and return false.
    intel[scoutKeys.notForRemote] = intel[scoutKeys.notForRemote] || []
    intel[scoutKeys.notForRemote].push(this.name)
    return false
  }

  return true
}

function getSourceKeeperRoomInfraPlan(room, targetRoomName) {
  Memory.rooms[targetRoomName] = Memory.rooms[targetRoomName] || {}
  if (Memory.rooms[targetRoomName].roomInCharge === room.name && Memory.rooms[targetRoomName].infraPlan) {
    return Memory.rooms[targetRoomName].infraPlan
  }

  const storage = room.storage
  if (!storage) {
    return
  }

  const targetRoom = Game.rooms[targetRoomName]
  if (!targetRoom) {
    return
  }

  const result = []

  const sources = targetRoom.find(FIND_SOURCES)
  const minerals = targetRoom.find(FIND_MINERALS)
  const roadPositions = []
  const basePlan = room.basePlan

  const keeperLairs = targetRoom.find(FIND_HOSTILE_STRUCTURES).filter(structure => structure.structureType === STRUCTURE_KEEPER_LAIR)

  for (const resource of [...sources, ...minerals]) {
    const search = PathFinder.search(resource.pos, { pos: storage.pos, range: 1 }, {
      plainCost: 5,
      swampCost: 6, // swampCost higher since road is more expensive on swamp
      heuristicWeight: 1,
      roomCallback: function (roomName) {
        const room = Game.rooms[roomName];
        if (!room) {
          return true;
        }

        const costs = new PathFinder.CostMatrix;
        for (const pos of roadPositions) {
          if (pos.roomName === roomName) {
            costs.set(pos.x, pos.y, 4)
          }
        }

        room.find(FIND_STRUCTURES).forEach(function (structure) {
          if (structure.structureType === STRUCTURE_ROAD) {
            costs.set(structure.pos.x, structure.pos.y, 3)
            return
          }

          if (room.isMy && structure.structureType === STRUCTURE_CONTAINER) {
            costs.set(structure.pos.x, structure.pos.y, 50)
            return
          }

          if (OBSTACLE_OBJECT_TYPES.includes(structure.structureType)) {
            costs.set(structure.pos.x, structure.pos.y, 255)
            return
          }

        })

        for (const sourceInner of room.sources) {
          if (resource.id === sourceInner.id) {
            continue
          }
          for (const pos of sourceInner.pos.getInRange(1)) {
            if (!pos.isWall && costs.get(pos.x, pos.y) < 50) {
              costs.set(pos.x, pos.y, 50)
            }
          }
        }

        if (roomName === room.name && basePlan) {
          for (let i = 1; i <= 8; i++) {
            for (const structure of basePlan[`lv${i}`]) {
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
      continue
    }

    const path = search.path
    visualizePath(path)

    roadPositions.push(...path)

    const keeperLair = resource.pos.findInRange(keeperLairs, 5)[0]

    const info = {}

    if (resource.mineralType) {
      info.isMineral = true
      info.mineralId = resource.id
      info.mineralType = resource.mineralType
    } else {
      info.sourceId = resource.id
    }

    info.keeperLairId = keeperLair.id

    info.pathLength = path.length

    if (info.isMineral) {
      info.maxCarry = Math.floor(path.length * SK_MINERAL_HAULER_RATIO) + 2
      info.eachCarry = Math.ceil(info.maxCarry / Math.ceil(info.maxCarry / 25))
    } else {
      info.maxCarry = Math.floor(path.length * SK_HAULER_RATIO) + 2
      info.eachCarry = Math.ceil(info.maxCarry / Math.ceil(info.maxCarry / 32))
    }

    const infraPlan = []

    if (!info.isMineral) {
      const containerPos = path.shift()

      infraPlan.push(containerPos.packInfraPos('container'))

      for (const pos of path) {
        infraPlan.push(pos.packInfraPos('road'))
      }
    }

    info.infraPlan = infraPlan

    result.push(info)
  }

  result.sort((a, b) => a.pathLength - b.pathLength)

  targetRoom.memory.roomInCharge = room.name
  targetRoom.memory.infraPlan = result
  return result
}

function runSourceKeeperRoomHandler(creep, roomName) {
  if (creep.spawning) {
    return
  }

  if (creep.hits < creep.hitsMax) {
    creep.heal(creep)
  }

  const room = Game.rooms[roomName]

  if (!room || creep.room.name !== roomName) {
    creep.moveToRoom(roomName, 2)
    return
  }

  const sourceKeepers = room.find(FIND_HOSTILE_CREEPS).filter(creep => creep.owner.username === 'Source Keeper')

  if (sourceKeepers.length === 0) {
    const nextSourceKeeperLair = getNextSourceKeeperLair(creep)
    if (nextSourceKeeperLair) {
      creep.moveMy({ pos: nextSourceKeeperLair.pos, range: 1 })
    }
    return
  } else {
    delete creep.heap.nextSourceKeeperLair
  }

  const closeSourceKeeper = sourceKeepers.find(sourceKeeper => creep.pos.getRangeTo(sourceKeeper) <= 1)
  if (closeSourceKeeper) {
    creep.move(creep.pos.getDirectionTo(closeSourceKeeper))
    creep.attack(closeSourceKeeper)
    return
  }

  const goals = sourceKeepers.map(sourceKeeper => {
    return { pos: sourceKeeper.pos, range: 1 }
  })
  creep.moveMy(goals)
  return

}

function getNextSourceKeeperLair(creep) {
  if (!creep.heap.nextSourceKeeperLair) {
    return creep.heap.nextSourceKeeperLair = findNextSourceKeeperLair(creep.room.name)
  }
  return creep.heap.nextSourceKeeperLair
}

function findNextSourceKeeperLair(roomName) {
  const room = Game.rooms[roomName]

  if (!room) {
    return undefined
  }

  const structures = room.find(FIND_HOSTILE_STRUCTURES)

  let result = undefined
  let ticksToSpawnMin = Infinity

  for (const structure of structures) {
    if (structure.structureType !== STRUCTURE_KEEPER_LAIR) {
      continue
    }

    const ticksToSpawn = structure.ticksToSpawn
    if (ticksToSpawn === undefined) {
      continue
    }
    if (ticksToSpawn < ticksToSpawnMin) {
      result = structure
      ticksToSpawnMin = ticksToSpawn
    }
  }

  return result
}

module.exports = {
  isStronghold,
}
const { GuardRequest, getCombatInfo } = require("./overlord_tasks_guard")
const { parseInfraPos } = require("./room_manager_remote")

const sourceKeeperHandlerBody = parseBody(`25m18a5h1a1h`)
const sourceKeeperMinerBody = parseBody('8w5m1w1c')

Room.prototype.manageSourceKeeperMining = function () {
  this.memory.activeSK = this.memory.activeSK || []
  for (const targetRoomName of this.memory.activeSK) {
    if (isStronghold(targetRoomName)) {
      return
    }

    const targetRoom = Game.rooms[targetRoomName]
    const memory = Memory.rooms[targetRoomName]

    if (targetRoom) {
      const invaders = targetRoom.findHostileCreeps().filter(creep => creep.owner.username !== 'Source Keeper')
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
      return
    }

    if (targetRoom && (!targetRoom.memory.constructionComplete || Game.time > (targetRoom.memory.constructionCompleteTime + 3000))) {
      constructSourceKeeperRoomInfra(this, targetRoomName)
    }

    manageSpawnSourceKeeperRoomWorkers(this, targetRoomName)

    manageSourceKeeperRoomWorkers(targetRoomName)
  }
}

function manageInvasion(room, targetRoomName) {
  const miners = Overlord.getCreepsByRole(targetRoomName, 'remoteMiner')
  const haulers = Overlord.getCreepsByRole(targetRoomName, 'remoteHauler')
  const sourceKeeperHandlers = Overlord.getCreepsByRole(targetRoomName, 'sourceKeeperHandler')

  for (const worker of [...miners, ...haulers, ...sourceKeeperHandlers]) {
    runAway(worker, room.name)
  }
}

function runAway(creep, roomName) {
  const hostileCreeps = creep.room.getEnemyCombatants()

  if (creep.pos.findInRange(hostileCreeps, 5).length > 0) {
    creep.fleeFrom(hostileCreeps, 6, 2)
    return
  }

  if (creep.memory.keeperLairId) {
    const keeperLair = Game.getObjectById(creep.memory.keeperLairId)
    if (keeperLair && keeperLair.ticksToSpawn < 15 && creep.pos.getRangeTo(keeperLair.pos) < 6) {
      creep.fleeFrom(keeperLair, 10)
      return
    }
  }

  if (creep.room.name !== roomName || isEdgeCoord(creep.pos.x, creep.pos.y)) {
    creep.moveToRoom(roomName)
  }
}

function isStronghold(targetRoomName) {
  const memory = Memory.rooms[targetRoomName]
  const invaderCoreInfo = memory.invaderCore

  const targetRoom = Game.rooms[targetRoomName]

  if (!targetRoom) {
    if (invaderCoreInfo) {
      if (invaderCoreInfo.deployTime && Game.time < invaderCoreInfo.deployTime) {
        return false
      }

      if (invaderCoreInfo.ticksToCollapse && Game.time < invaderCoreInfo.ticksToCollapse) {
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
    const packedStructures = info.infraPlan
    let numConstructionSites = 0
    for (const packedStructure of packedStructures) {
      const parsed = parseInfraPos(packedStructure)
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

      if (numConstructionSites >= 3) {
        break
      }
    }
  }

  targetRoom.memory.constructionComplete = complete

  if (complete) {
    targetRoom.memory.constructionCompleteTime = Game.time
  }
}

function manageSourceKeeperRoomWorkers(targetRoomName) {
  const miners = Overlord.getCreepsByRole(targetRoomName, 'remoteMiner')
  const haulers = Overlord.getCreepsByRole(targetRoomName, 'remoteHauler')
  const sourceKeeperHandlers = Overlord.getCreepsByRole(targetRoomName, 'sourceKeeperHandler')

  for (const miner of miners) {
    runMineSourceKeeperRoom(miner, targetRoomName)
  }

  for (const hauler of haulers) {
    runHaulSourceKeeperRoom(hauler, targetRoomName)
  }

  for (const sourceKeeperHandler of sourceKeeperHandlers) {
    runHandleSourceKeepers(sourceKeeperHandler, targetRoomName)
  }
}

function runHaulSourceKeeperRoom(creep, targetRoomName) {
  if (creep.spawning) {
    return
  }

  const targetRoom = Game.rooms[targetRoomName]

  if (!targetRoom) {
    creep.moveToRoom(targetRoomName)
    return
  }

  const hostileCreeps = creep.room.getEnemyCombatants()

  if (creep.pos.findInRange(hostileCreeps, 7).length > 0) {
    creep.fleeFrom(hostileCreeps, 5)
    return
  }

  if (creep.memory.keeperLairId) {
    const keeperLair = Game.getObjectById(creep.memory.keeperLairId)
    if (keeperLair.ticksToSpawn < 15 && creep.pos.getRangeTo(keeperLair.pos) < 6) {
      creep.fleeFrom(keeperLair, 6)
      return
    }
  }

  // 논리회로
  if (creep.memory.supplying && creep.store[RESOURCE_ENERGY] === 0) {
    if (creep.room.name === creep.memory.base && creep.ticksToLive < 2.2 * (creep.memory.sourcePathLength || 0)) {
      creep.memory.getRecycled = true
      return
    }
    creep.memory.supplying = false
  } else if (!creep.memory.supplying && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
    // const base = Game.rooms[creep.memory.base]
    // const amount = creep.store.getUsedCapacity(RESOURCE_ENERGY)
    // if (base) {
    //     base.addRemoteProfit(creep.memory.colony, amount)
    // }
    creep.memory.supplying = true
  }

  // 행동
  if (creep.memory.supplying) {
    const targetRoom = Game.rooms[creep.memory.targetRoomName]
    const constructionSites = targetRoom ? targetRoom.constructionSites : []

    if (constructionSites.length > 0 && creep.getActiveBodyparts(WORK) > 0) {
      if (creep.room.name !== creep.memory.targetRoomName || isEdgeCoord(creep.pos.x, creep.pos.y)) {
        creep.moveToRoom(creep.memory.targetRoomName)
        return
      }

      if (!creep.heap.targetId) {
        creep.heap.targetId = creep.pos.findClosestByRange(constructionSites).id
      }

      const target = creep.heap.targetId ? Game.getObjectById(creep.heap.targetId) : undefined

      if (!target) {
        delete creep.heap.targetId
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

    const room = Game.rooms[creep.memory.base]
    if (!room) {
      creep.suicide()
    }

    if (creep.room.name === creep.memory.base) {
      return
    }

    const closeBrokenThings = creep.pos.findInRange(creep.room.structures.damaged, 1).filter(structure => structure.structureType === STRUCTURE_ROAD)
    if (closeBrokenThings.length) {
      creep.repair(closeBrokenThings[0])
    }

    const spawn = room.structures.spawn[0]
    if (spawn) {
      creep.moveMy({ pos: spawn.pos, range: 3 })
    }
    return
  }

  if (creep.ticksToLive < 1.1 * (creep.memory.sourcePathLength || 0)) {
    creep.memory.getRecycled = true
    // const base = Game.rooms[creep.memory.base]
    // const amount = creep.store.getUsedCapacity(RESOURCE_ENERGY)
    // if (base) {
    //   base.addRemoteProfit(creep.memory.colony, amount)
    // }
    return
  }

  const source = Game.getObjectById(creep.memory.sourceId)

  if (!source) {
    creep.moveToRoom(creep.memory.targetRoomName)
    return
  }

  const droppedEnergy = creep.pos.findInRange(FIND_DROPPED_RESOURCES, 5).find(energy => energy.amount >= 50)

  const tombstone = creep.pos.findInRange(FIND_TOMBSTONES, 5).find(tombstone => tombstone.store[RESOURCE_ENERGY] >= 50)
  if (tombstone) {
    creep.getEnergyFrom(tombstone.id)
    return
  }

  if (droppedEnergy) {
    creep.getEnergyFrom(droppedEnergy.id)
    return
  }

  if (source.container && source.container.store[RESOURCE_ENERGY] >= Math.min(creep.store.getFreeCapacity(), 500)) {
    creep.getEnergyFrom(source.container.id)
    return
  }

  if (creep.pos.getRangeTo(source.pos) > 3) {
    creep.moveMy({ pos: source.pos, range: 3 })
  }

  creep.setWorkingInfo(source.pos, 3)
  return
}

function runMineSourceKeeperRoom(creep, targetRoomName) {
  if (creep.spawning) {
    return
  }

  const targetRoom = Game.rooms[targetRoomName]

  if (!targetRoom) {
    creep.moveToRoom(targetRoomName)
    return
  }

  const hostileCreeps = creep.room.getEnemyCombatants()

  if (creep.pos.findInRange(hostileCreeps, 7).length > 0) {
    creep.fleeFrom(hostileCreeps, 5)
    return
  }

  if (creep.memory.keeperLairId) {
    const keeperLair = Game.getObjectById(creep.memory.keeperLairId)

    if (keeperLair && keeperLair.ticksToSpawn < 15) {
      creep.fleeFrom(keeperLair, 6)
      return
    }
  }

  const source = Game.getObjectById(creep.memory.sourceId)
  const container = source.container

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
    const sourceId = info.sourceId
    sourceStat[sourceId] = sourceStat[sourceId] || {}
    sourceStat[sourceId].work = 0
    sourceStat[sourceId].carry = 0
    sourceStat[sourceId].repair = 0
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

  for (const info of infraPlan) {
    const sourceId = info.sourceId
    const stat = sourceStat[sourceId]
    const keeperLairId = info.keeperLairId

    if (stat.work < 9) {
      room.requestRemoteMiner(targetRoomName, sourceId, { keeperLairId })
      return
    }

    const constructing = Memory.rooms[targetRoomName] && !Memory.rooms[targetRoomName].constructionComplete

    if (constructing) {
      if (stat.repair < 12) {
        room.requestRemoteHauler(targetRoomName, sourceId, { constructing, keeperLairId })
        return
      }
    } else if (stat.carry < info.maxCarry) {
      const maxCarry = info.eachCarry
      const sourcePathLength = info.pathLength
      const isRepairer = stat.repair < 2
      room.requestRemoteHauler(targetRoomName, sourceId, { constructing, keeperLairId, isRepairer, sourcePathLength, maxCarry })
      return
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
    body.push(WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, CARRY, CARRY, CARRY, CARRY,)
    cost += 800
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

  if (options.isRepairer) {
    memory.isRepairer = true
  }

  if (options.sourcePathLength) {
    memory.sourcePathLength = options.sourcePathLength
  }

  if (options.keeperLairId) {
    memory.keeperLairId = options.keeperLairId
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['remoteHauler'], cost: cost })
  this.spawnQueue.push(request)
}


Room.prototype.requestRemoteMiner = function (targetRoomName, sourceId, options = {}) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  let cost = 1200
  const body = sourceKeeperMinerBody

  const name = `${targetRoomName} remoteMiner ${Game.time}_${this.spawnQueue.length}`
  const memory = {
    role: 'remoteMiner',
    base: this.name,
    targetRoomName,
    sourceId,
  }

  if (options.keeperLairId) {
    memory.keeperLairId = options.keeperLairId
  }

  if (options.containerId) {
    memory.containerId = options.containerId
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['remoteMiner'], cost: cost })
  this.spawnQueue.push(request)
}

function getSourceKeeperRoomInfraPlan(room, targetRoomName) {
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
  const roadPositions = []
  const basePlan = room.basePlan

  const keeperLairs = targetRoom.find(FIND_HOSTILE_STRUCTURES).filter(structure => structure.structureType === STRUCTURE_KEEPER_LAIR)

  for (const source of sources) {
    const search = PathFinder.search(source.pos, { pos: storage.pos, range: 1 }, {
      plainCost: 5,
      swampCost: 6, // swampCost higher since road is more expensive on swamp
      roomCallback: function (roomName) {
        const room = Game.rooms[roomName];
        if (!room) {
          return true;
        }

        const costs = new PathFinder.CostMatrix;
        for (const pos of roadPositions) {
          if (pos.roomName === roomName) {
            costs.set(pos.x, pos.y, 3)
          }
        }

        room.find(FIND_STRUCTURES).forEach(function (structure) {
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

        for (const sourceInner of room.sources) {
          if (source.id === sourceInner.id) {
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

    const keeperLair = source.pos.findInRange(keeperLairs, 5)[0]

    const info = {}

    info.sourceId = source.id

    info.keeperLairId = keeperLair.id

    info.pathLength = path.length

    info.maxCarry = Math.floor(path.length * 0.8)

    info.eachCarry = Math.ceil(info.maxCarry / Math.ceil(info.maxCarry / 32))

    const infraPlan = []
    const containerPos = path.shift()

    infraPlan.push(containerPos.packInfraPos('container'))

    for (const pos of path) {
      infraPlan.push(pos.packInfraPos('road'))
    }

    info.infraPlan = infraPlan

    result.push(info)
  }

  result.sort((a, b) => a.pathLength - b.pathLength)

  targetRoom.memory.roomInCharge = room.name
  targetRoom.memory.infraPlan = result
  return result
}

Room.prototype.requestSourceKeeperHandler = function (targetRoomName) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const body = sourceKeeperHandlerBody
  const cost = 4270

  const name = `${targetRoomName} sourceKeeperHandler ${Game.time}_${this.spawnQueue.length}`

  const memory = {
    role: 'sourceKeeperHandler',
    base: this.name,
    targetRoomName: targetRoomName
  }

  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['sourceKeeperHandler'], cost: cost })
  this.spawnQueue.push(request)
}

function runHandleSourceKeepers(creep, roomName) {
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
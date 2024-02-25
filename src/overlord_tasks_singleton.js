const { config } = require('./config')
const { moreImportantTarget } = require('./quad_prototype')

const IMPORTANT_STRUCTURE_TYPES = config.IMPORTANT_STRUCTURE_TYPES

global.sendSingleton = function (targetRoomName, number = 1) {
  const level = 8

  targetRoomName = targetRoomName.toUpperCase()
  const base = Overlord.findClosestMyRoom(targetRoomName, level, 2)

  if (!base) {
    return `there is no adequate base`
  }

  const options = {}

  options.number = number

  const request = new SingletonRequest(base, targetRoomName, options)

  Overlord.registerTask(request)
  return `${base} send ${number > 1 ? number : 'a'} ${number > 1 ? 'singletons' : 'singleton'} to ${targetRoomName}`
}

Overlord.manageSingletonTasks = function () {
  const tasks = this.getTasksWithCategory('singleton')

  for (const request of Object.values(tasks)) {
    const roomInCharge = Game.rooms[request.roomNameInCharge]

    if (!roomInCharge) {
      this.deleteTask(request)
      continue
    }

    if (request.complete) {
      this.deleteTask(request)
      continue
    }

    roomInCharge.runSingletonTask(request)
  }
}

Room.prototype.runSingletonTask = function (request) {
  const roomName = request.roomName

  const number = request.number

  const singletons = Overlord.getCreepsByRole(roomName, 'singleton').filter(
    (creep) => creep.memory.task && creep.memory.task.id === request.id
  )

  const ticksToLiveMin = Math.min(Math.min(...singletons.map((creep) => creep.ticksToLive || 1500)), 1500)

  request.ticksToLive = ticksToLiveMin

  if (request.status === 'produce') {
    if (singletons.length < number) {
      this.requestSingleton(roomName, { task: request })
      return
    }

    if (singletons.some((creep) => creep.spawning || creep.memory.boosted === false)) {
      return
    }
    request.status = 'engage'
    return
  }

  if (request.status === 'engage') {
    if (singletons.length === 0) {
      request.complete = true
      return
    }

    for (const singleton of singletons) {
      if (singleton.spawning || singleton.memory.boosted === false) {
        continue
      }
      runSingletonAttackRoom(singleton, roomName)
    }
  }
}

const SingletonRequest = function (room, targetRoomName, options) {
  const defaultOptions = { number: 1 }
  const mergedOptions = { ...defaultOptions, ...options }
  const { number } = mergedOptions

  this.category = 'singleton'
  this.id = `${this.category} ${targetRoomName} ${Game.time}`

  this.startTime = Game.time
  this.status = 'produce'
  this.ticksToLive = 1500

  this.number = number

  this.roomName = targetRoomName
  this.roomNameInCharge = room.name
}

function runSingletonAttackRoom(creep, targetRoomName) {
  creep.heal(creep)
  if (creep.memory.return) {
    creep.activeRangedAttack()
    creep.moveToRoom(creep.memory.base, 2)
    return
  }

  if (creep.room.name !== targetRoomName) {
    creep.activeRangedAttack()
    creep.moveToRoom(targetRoomName, 2)
    return
  }

  creep.singletonRangedAttack()

  if (creep.room.controller.safeMode > 0) {
    creep.memory.return = true
    return
  }

  if (creep.hits < creep.hitsMax) {
    retreat(creep)
    return
  }

  if (isDanger(creep)) {
    retreat(creep)
    return
  }

  const costArray = getSingletonCostArrayForAttackRoom(creep)

  if (!costArray) {
    retreat(creep)
    return
  }

  const path = getSingletonPathForAttackRoom(creep, costArray)

  visualizePath(path, creep.pos)

  if (path === ERR_NOT_FOUND) {
    retreat(creep)
    return
  }

  const nextPos = creep.pos.getNextPosFromPath(path)

  if (nextPos) {
    const direction = creep.pos.getDirectionTo(nextPos)
    creep.move(direction)
  }
}

Creep.prototype.singletonRangedAttack = function () {
  const allies = this.room.find(FIND_CREEPS).filter((creep) => creep.isAlly())
  const isAlly = this.pos.findInRange(allies, 3).length > 0
  let rangedMassAttackTotalDamage = 0

  const positions = this.pos.getInRange(3)
  const rangedAttackPower = this.rangedAttackPower

  let rangedAttackTarget = undefined

  for (const pos of positions) {
    const priorityTarget = this.getPriorityTarget(pos)

    if (!priorityTarget) {
      continue
    }

    if (rangedAttackTarget === undefined) {
      rangedAttackTarget = priorityTarget
    } else {
      rangedAttackTarget = moreImportantTarget(priorityTarget, rangedAttackTarget)
    }

    if (priorityTarget.my === false) {
      const range = this.pos.getRangeTo(pos)

      if (range <= 1 && !isAlly) {
        this.rangedMassAttack()
        return
      }

      const rangeConstant = range <= 1 ? 1 : range <= 2 ? 0.4 : 0.1
      const damage = rangedAttackPower * rangeConstant

      rangedMassAttackTotalDamage += damage
      continue
    }
  }

  if (rangedMassAttackTotalDamage >= rangedAttackPower && !isAlly) {
    this.rangedMassAttack()
    return
  }

  if (rangedAttackTarget) {
    this.rangedAttack(rangedAttackTarget)
  }
}

function retreat(creep) {
  const damageArray = creep.room.getDamageArray()
  const adjacents = creep.pos.getAtRange(1)
  const posToRetreat = getMinObject(adjacents, (pos) => damageArray[packCoord(pos.x, pos.y)] + (pos.isSwamp ? 100 : 0))
  if (posToRetreat) {
    const direction = creep.pos.getDirectionTo(posToRetreat)
    creep.move(direction)
    return
  }
  creep.moveToRoom(creep.memory.base, 2)
  return
}

function isDanger(creep) {
  const damageArray = creep.room.getDamageArray()
  const damage = damageArray[packCoord(creep.pos.x, creep.pos.y)]
  return creep.healPower < creep.getEffectiveDamage(damage)
}

function getSingletonPathForAttackRoom(creep, costArray) {
  const hostileCreeps = creep.room.findHostileCreeps()
  const hostileStructures = creep.room.find(FIND_HOSTILE_STRUCTURES)
  const importantStructures = hostileStructures.filter((structure) => {
    if (!IMPORTANT_STRUCTURE_TYPES.includes(structure.structureType)) {
      return false
    }

    const packed = packCoord(structure.pos.x, structure.pos.y)
    if (costArray[packed] === 0) {
      return false
    }

    return true
  })

  const targetStructures = importantStructures.length > 0 ? importantStructures : hostileStructures

  const goals = []

  const structureRange = 0
  for (const structure of targetStructures) {
    const pos = structure.pos
    const goal = { pos, range: structureRange }
    goals.push(goal)
  }

  const creepRange = 3
  for (const creep of hostileCreeps) {
    const pos = creep.pos

    if (pos.isRampart) {
      continue
    }

    const goal = { pos, range: creepRange }
    goals.push(goal)
  }

  return creep.room.dijkstra(creep.pos, goals, costArray)
}

function getSingletonCostArrayForAttackRoom(creep) {
  const costArray = getSingletonCostArrayForBulldoze(creep)

  if (!costArray) {
    return
  }

  const result = new Uint32Array(2500)

  const damageArray = creep.room.getDamageArray()

  for (let i = 0; i < 2500; i++) {
    const costBefore = costArray[i]
    result[i] = costBefore
    if (costBefore > 0) {
      const netHeal = creep.healPower - creep.getEffectiveDamage(damageArray[i])
      if (netHeal < 0) {
        result[i] = 0
      }
    }
  }

  const myCreeps = creep.room.find(FIND_MY_CREEPS)
  const allyCreeps = creep.room.find(FIND_HOSTILE_CREEPS).filter((creep) => creep.isAlly())

  for (const otherCreep of [...myCreeps, ...allyCreeps]) {
    if (creep.name !== otherCreep.name) {
      const packed = packCoord(otherCreep.pos.x, otherCreep.pos.y)
      result[packed] = 0
    }
  }

  return result
}

function getSingletonCostArrayForBulldoze(creep) {
  if (Game.time > creep.heap._costArrayForBulldozeTime + 10) {
    delete creep.heap._costArrayForBulldoze
  }

  if (creep.heap._costArrayForBulldoze) {
    return creep.heap._costArrayForBulldoze
  }

  const power = creep.attackPower

  if (power === 0) {
    return undefined
  }

  const costArray = creep.room.getCostArrayForBulldoze(power)

  creep.heap._costArrayForBulldozeTime = Game.time
  return (creep.heap._costArrayForBulldoze = costArray)
}

Room.prototype.requestSingleton = function (roomName, options) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const task = options.task

  const name = `${roomName} singleton ${Game.time}_${this.spawnQueue.length}`

  const body = parseBody('9t12r10m19h')

  const memory = {
    role: 'singleton',
    base: this.name,
    roomName,
  }

  const spawnOptions = { priority: 4 }

  const boostResources = ['XZHO2', 'XGHO2', 'XLHO2', 'XKHO2']
  spawnOptions.boostResources = boostResources
  memory.boosted = false

  if (task) {
    memory.task = { category: task.category, id: task.id }
  }

  const request = new RequestSpawn(body, name, memory, spawnOptions)

  this.spawnQueue.push(request)
}

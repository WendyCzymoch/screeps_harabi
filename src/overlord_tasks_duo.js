Overlord.manageDuoTasks = function () {
  const tasks = this.getTasksWithCategory('duo')

  for (const request of Object.values(tasks)) {
    const roomNameInCharge = request.roomNameInCharge
    const roomInCharge = Game.rooms[roomNameInCharge]
    if (!roomInCharge) {
      this.deleteTask(request)
      return 'no room in charge'
    }
    if (request.complete) {
      console.log(request.result)
      this.deleteTask(request)
      continue
    }
    roomInCharge.runDuoTask(request)
  }
}

Room.prototype.runDuoTask = function (request) {
  const boost = request.boost

  const mainName = request.mainName
  const healerName = request.healerName

  const attacker = Game.creeps[mainName]
  const healer = Game.creeps[healerName]

  if (request.startAttack && !attacker && !healer) {
    request.complete = true
    request.result = request.result || 'agents died'
    request.status = 'end'
    return
  }

  request.currentRoom = attacker ? attacker.room.name : this.name

  if (!request.startAttack && !attacker) {
    this.requestAttacker(request, request.species, boost)
    request.status = 'produce'
    return
  }

  if (!request.startAttack && !healer) {
    request.status = 'produce'
    this.requestHealer(request, boost)
    return
  }

  if (!attacker || !healer) {
    if (request.boosted) {
      request.status = 'end'
    } else {
      request.status = 'produce'
    }
    return
  }

  request.ticksToLive =
    attacker && healer
      ? Math.min(attacker.ticksToLive || CREEP_LIFE_TIME, healer.ticksToLive || CREEP_LIFE_TIME)
      : CREEP_LIFE_TIME

  if (boost > 0 && !request.boosted) {
    request.boosted = attacker.memory.boosted !== false && healer.memory.boosted !== false
    return
  }

  request.startAttack = true
  if (attacker.room.name === request.roomName) {
    request.status = 'attack'
  } else {
    request.status = 'travel'
  }
  attacker.attackRoom(request)
  healer.care(attacker)
}

const DuoRequest = function (room, targetRoomName, options) {
  const defaultOptions = { boost: 1, species: 'ant' }
  const mergedOptions = { ...defaultOptions, ...options }

  const { boost, species } = mergedOptions

  this.category = 'duo'
  this.id = targetRoomName + Game.time

  this.roomName = targetRoomName
  this.roomNameInCharge = room.name

  this.mainName = `${targetRoomName} ${species} ${Game.time}`
  this.healerName = `${targetRoomName} healer ${Game.time}`
  this.species = species
  this.boost = boost
  this.ticksToLive = CREEP_LIFE_TIME

  this.status = 'produce'
}

global.sendDuo = function (targetRoomName, species, boost = undefined) {
  targetRoomName = targetRoomName.toUpperCase()
  const base = Overlord.findClosestMyRoom(targetRoomName, 7)

  if (!base) {
    return `there is no adequate base`
  }

  if (!base.canProduceSquad()) {
    return `base ${base.name} is producing some squad`
  }

  const availableBoost = base.getAvailableDuoBoost(species)

  if (boost === undefined || !availableBoost.includes(boost)) {
    boost = Math.max(...availableBoost)
  }

  if (boost !== undefined && !availableBoost.includes(boost)) {
    return `base ${base.name} cannot boost T${boost}`
  }

  const options = {}

  options.boost = boost
  options.species = species

  const request = new DuoRequest(base, targetRoomName, options)

  Overlord.registerTask(request)
  return `${base} send ${species} duo to ${targetRoomName} with T${boost} boost`
}

global.redirectDuo = function (fromRoomName, toRoomName) {
  fromRoomName = fromRoomName.toUpperCase()
  toRoomName = toRoomName.toUpperCase()
  const tasks = Overlord.getTasksWithCategory('duo')
  for (const request of Object.values(tasks)) {
    if (request.roomName === fromRoomName) {
      request.roomName = toRoomName
    }
  }
  return `redirected duos from ${fromRoomName} to ${toRoomName}`
}

Room.prototype.getAvailableDuoBoost = function (species) {
  const result = [0]
  const resources = Memory.stats ? Memory.stats.resources : undefined

  if (!resources) {
    return result
  }

  if (this.controller.level < 7) {
    return result
  }

  const numAvailableDuo = Overlord.getNumAvailableDuo()

  const maxBoost = this.controller.level >= 8 ? 3 : 2

  for (const boost in numAvailableDuo[species]) {
    const boostToNumber = Number(boost)
    if (boostToNumber > maxBoost) {
      continue
    }
    if (numAvailableDuo[species][boost] > 0) {
      result.push(boostToNumber)
    }
  }

  return result
}

Overlord.getNumAvailableDuo = function () {
  if (Game._numAvailableDuo) {
    return Game._numAvailableDuo
  }
  const result = {}
  result.ant = { 1: 0, 2: 0, 3: 0 }
  result.worm = { 1: 0, 2: 0, 3: 0 }

  const resources = Memory.stats ? Memory.stats.resources : undefined
  if (!resources) {
    return result
  }

  for (let i = 1; i <= 3; i++) {
    const antBody = DUO_ANT_BODY[i]
    const wormBody = DUO_WORM_BODY[i]
    const healerBody = DUO_HEALER_BODY[i]

    const antResourceTypes = DUO_ANT_BOOST_RESOURCES[i]
    const wormResourceTypes = DUO_WORM_BOOST_RESOURCES[i]
    const healerResourceTypes = DUO_HEALER_BOOST_RESOURCES[i]

    const antRequiredResources = getRequiredResourcesToBoost(antBody, antResourceTypes)
    const wormRequiredResources = getRequiredResourcesToBoost(wormBody, wormResourceTypes)
    const healerRequiredResources = getRequiredResourcesToBoost(healerBody, healerResourceTypes)

    let maxHealer = Infinity
    for (const resourceType of healerResourceTypes) {
      const resourceAmount = resources[resourceType] || 0
      maxHealer = Math.min(maxHealer, Math.floor(resourceAmount / healerRequiredResources[resourceType]))
    }

    let maxAnt = Infinity
    for (const resourceType of antResourceTypes) {
      const resourceAmount = resources[resourceType] || 0
      maxAnt = Math.min(maxAnt, Math.floor(resourceAmount / antRequiredResources[resourceType]))
    }

    let maxWorm = Infinity
    for (const resourceType of wormResourceTypes) {
      const resourceAmount = resources[resourceType] || 0
      maxWorm = Math.min(maxWorm, Math.floor(resourceAmount / wormRequiredResources[resourceType]))
    }

    result.ant[i] = Math.min(maxAnt, maxHealer)
    result.worm[i] = Math.min(maxWorm, maxHealer)
  }

  return (Game._numAvailableDuo = result)
}

Room.prototype.requestAttacker = function (request, species, boost = 0) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const name = request.mainName

  const bodyTemplate = species === 'worm' ? DUO_WORM_BODY : DUO_ANT_BODY

  const body = bodyTemplate[boost]

  const memory = {
    role: 'attacker',
    healer: request.healerName,
    base: this.name,
  }

  const options = { priority: SPAWN_PRIORITY['attacker'] }
  if (boost > 0) {
    const boostResources = species === 'worm' ? DUO_WORM_BOOST_RESOURCES[boost] : DUO_ANT_BOOST_RESOURCES[boost]
    options.boostResources = boostResources
    memory.boosted = false
  }

  this.spawnQueue.push(new RequestSpawn(body, name, memory, options))
}

Room.prototype.requestHealer = function (request, boost = 0) {
  if (!this.hasAvailableSpawn()) {
    return
  }

  const name = request.healerName

  const body = DUO_HEALER_BODY[boost]

  const memory = {
    role: 'healer',
    healer: request.mainName,
    base: this.name,
  }

  const options = { priority: SPAWN_PRIORITY['healer'] }
  if (boost) {
    options.boostResources = DUO_HEALER_BOOST_RESOURCES[boost]
    memory.boosted = false
  }

  this.spawnQueue.push(new RequestSpawn(body, name, memory, options))
}

const DUO_ANT_BODY = {
  0: parseBody('25a25m'),
  1: parseBody('32a16m'),
  2: parseBody('36a12m'),
  3: parseBody('15t25a10m'),
}

const DUO_WORM_BODY = {
  0: parseBody('25w25m'),
  1: parseBody('32w16m'),
  2: parseBody('36w12m'),
  3: parseBody('12t28w10m'),
}

const DUO_HEALER_BODY = {
  0: parseBody('18m18h'),
  1: parseBody('10m20h'),
  2: parseBody('7m21h'),
  3: parseBody('12t5r22h10m1h'),
}

const DUO_ANT_BOOST_RESOURCES = {
  1: ['ZO', 'UH'],
  2: ['ZHO2', 'UH2O'],
  3: ['XGHO2', 'XZHO2', 'XUH2O'],
}

const DUO_WORM_BOOST_RESOURCES = {
  1: ['ZO', 'ZH'],
  2: ['ZHO2', 'ZH2O'],
  3: ['XGHO2', 'XZHO2', 'XZH2O'],
}

const DUO_HEALER_BOOST_RESOURCES = {
  1: ['ZO', 'LO'],
  2: ['ZHO2', 'LHO2'],
  3: ['XGHO2', 'XZHO2', 'XLHO2', 'XKHO2'],
}

module.exports = {
  DuoRequest,
}

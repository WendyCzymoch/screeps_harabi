const { config } = require("./config")
const { getRemoteValue } = require("./room_manager_remote")

const SCOUT_INTERVAL_UNDER_RCL_8 = 6000 // scout 시작 후 얼마나 지나야 리셋할건지 1000보다 커야함.
const SCOUT_INTERVAL_AT_RCL_8 = 1000

global.scoutKeys = {
  numSource: 0,
  mineralType: 1,
  isAccessibleToContorller: 2,
  owner: 3,
  RCL: 4,
  isAlly: 5,
  isMy: 6,
  isEnemy: 7,
  numTower: 8,
  isMyRemote: 9,
  reservationOwner: 10,
  isAllyRemote: 11,
  isRemoteCandidate: 12,
  claimScore: 13,
  lastScout: 14,

  inaccessible: 15,
  lastHarassTick: 16,
  roomStatus: 17,
  roomStatusTime: 18,
  threat: 19,
  notForRemote: 20,
}

Room.prototype.manageScout = function () {
  const MAX_DISTANCE = (SHARD === 'swc') ? 20 : 10 // 최대 거리

  this.memory.scout = this.memory.scout || {}
  const status = this.memory.scout
  status.depth = status.depth || {}

  if (!status.startTick) {
    status.startTick = Game.time
  }

  // SCOUT_INTERVAL 마다 새로 정찰
  const scoutInterval = this.structures.observer.length > 0 ? SCOUT_INTERVAL_AT_RCL_8 : SCOUT_INTERVAL_UNDER_RCL_8

  if (Game.time - status.startTick > scoutInterval) {
    delete this.memory.scout
  }

  if (!status.state) {
    status.state = 'init'
    return
  }

  if (status.state === 'init') {
    status.queue = new Array()
    status.queue.push(this.name)
    status.depth[this.name] = 0
    status.state = 'BFS'
    return
  }

  outer:
  while (status.state === 'BFS') {
    if (status.adjacents && status.adjacents.length > 0) {
      while (status.adjacents.length > 0) {
        status.next = status.adjacents.shift()
        status.state = 'scout'
        break outer
      }
    }

    while (status.queue.length > 0) {
      const node = status.queue.shift()
      const intel = Overlord.getIntel(node)
      const distance = Game.map.getRoomLinearDistance(this.name, node)
      if (distance > MAX_DISTANCE) {
        continue
      }

      if (intel[scoutKeys.inaccessible] && intel[scoutKeys.inaccessible] > Game.time) {
        continue
      }
      const thisName = this.name
      status.node = node
      status.adjacents = Overlord.getAdjacentRoomNames(node).filter(function (roomName) {
        const adjacentDistance = Game.map.getRoomLinearDistance(thisName, roomName)
        if (adjacentDistance > MAX_DISTANCE) {
          return false
        }

        const roomStatus = Overlord.getRoomStatus(roomName).status

        if (roomStatus !== undefined && roomStatus !== 'normal') {
          return false
        }

        // 이미 본 거면 제외
        if (status.depth[roomName] !== undefined) {
          return false
        }

        return true
      })

      while (status.adjacents.length > 0) {
        status.next = status.adjacents.shift()
        status.state = 'scout'
        break outer
      }
    }
    status.state = 'wait'
    break outer
  }

  if (status.state === 'scout') {
    const roomName = status.next
    const intel = Overlord.getIntel(status.next)
    const node = status.node
    const depth = status.depth[node] + 1

    const distanceToRemote = config.distanceToRemote
    if (Game.map.getRoomLinearDistance(this.name, roomName) <= distanceToRemote && depth <= 2 * distanceToRemote) {
      const room = Game.rooms[roomName]
      if (!room || !intel) {
        this.acquireVision(roomName)
        return
      }

      const roomType = getRoomType(roomName)
      if (roomType === 'sourceKeeper') {
        if (this.checkSourceKeeperRoom(roomName)) {
          this.memory.activeSK = this.memory.activeSK || []
          data.recordLog(`SK: ${this.name} starts mining ${roomName}`, roomName)
          this.memory.activeSK.push(roomName)
        }
      } else if (intel[scoutKeys.isRemoteCandidate]) {
        this.tryRemote(roomName)
      }
    } else if (this.memory.remotes && this.memory.remotes[roomName]) {
      delete this.memory.remotes[roomName]
      delete this.memory.activeRemotes
    }

    // success
    if (intel[scoutKeys.lastScout] && (Game.time < intel[scoutKeys.lastScout] + scoutInterval)) {

      status.depth[roomName] = depth
      status.queue.push(roomName)
      delete status.next

      status.state = 'BFS'
      return
    }
    const result = this.acquireVision(status.next)

    // failure
    if (result === ERR_NO_PATH) {
      status.depth[status.next] = true
      status.queue.push(status.next)
      delete status.next

      status.state = 'BFS'
    }
    return
  }

  if (status.state === 'wait') {
    return
  }
}

Room.prototype.updateIntel = function () {
  const intelBefore = this.memory.intel || {}

  if (intelBefore[scoutKeys.lastScout] && (Game.time < intelBefore[scoutKeys.lastScout] + 1000)) {
    return
  }

  const roomName = this.name

  const roomType = getRoomType(roomName)

  switch (roomType) {
    case 'highway':
      this.cachePortals()
      this.checkHighway()
      break;
    case 'normal':
      break;
    case 'center':
      this.cachePortals()
      this.cacheResourceInfo()
      break;
    case 'sourceKeeper':
      this.cacheResourceInfo()
      break;
  }

  const intel = this.analyzeIntel()

  intel[scoutKeys.inaccessible] = intelBefore[scoutKeys.inaccessible]
  intel[scoutKeys.lastHarassTick] = intelBefore[scoutKeys.lastHarassTick]
  intel[scoutKeys.roomStatus] = intelBefore[scoutKeys.roomStatus]
  intel[scoutKeys.roomStatusTime] = intelBefore[scoutKeys.roomStatusTime]
  intel[scoutKeys.threat] = intelBefore[scoutKeys.threat]
  intel[scoutKeys.notForRemote] = intelBefore[scoutKeys.notForRemote]

  this.memory.intel = intel
}

Room.prototype.tryRemote = function (roomName) {
  const intel = Overlord.getIntel(roomName)

  if (!Game.rooms[roomName]) {
    return
  }

  // not adequate
  if (!intel[scoutKeys.isRemoteCandidate]) {
    return
  }

  if (intel[scoutKeys.notForRemote] !== undefined && intel[scoutKeys.notForRemote].includes(this.name)) {
    return
  }

  // already my remote
  if (this.memory.remotes && Object.keys(this.memory.remotes).includes(roomName)) {
    return
  }

  const value = getRemoteValue(this, roomName)

  if (value <= 0) {
    intel[scoutKeys.notForRemote] = intel[scoutKeys.notForRemote] || []
    intel[scoutKeys.notForRemote].push(this.name)
    return
  }

  const roomBefore = findRemoteHost(roomName)

  // no competition
  if (!roomBefore) {
    this.addRemote(roomName)
    return
  }

  // competition

  const valueBefore = getRemoteValue(roomBefore, roomName)

  if (value > valueBefore) {
    roomBefore.deleteRemote(roomName)
    this.addRemote(roomName)
    return
  }
}

Room.prototype.analyzeIntel = function () {
  const result = {}

  result[scoutKeys.numSource] = this.find(FIND_SOURCES).length
  result[scoutKeys.mineralType] = this.mineral ? this.mineral.mineralType : undefined
  result[scoutKeys.numTower] = this.structures.tower.filter(tower => tower.RCLActionable).length

  const isController = (this.controller !== undefined)
  if (isController) {
    const owner = this.controller.owner
    result[scoutKeys.isAccessibleToContorller] = this.getAccessibleToController()

    if (owner) {
      const username = owner.username
      result[scoutKeys.owner] = username
      result[scoutKeys.RCL] = this.controller.level
      result[scoutKeys.isAlly] = allies.includes(username)
      result[scoutKeys.isMy] = (username === MY_NAME)
      result[scoutKeys.isEnemy] = ((!result[scoutKeys.isAlly]) && (!result[scoutKeys.isMy]))
    }

    result[scoutKeys.isMyRemote] = Overlord.remotes.includes(this.name)

    const reservation = this.controller.reservation
    if (reservation) {
      const username = reservation.username

      result[scoutKeys.reservationOwner] = username
      result[scoutKeys.isAllyRemote] = allies.includes(username)
    }

    if (result[scoutKeys.isAccessibleToContorller] && !result[scoutKeys.owner]) {
      if (!result[scoutKeys.isAllyRemote] && (result[scoutKeys.numSource] > 0)) {
        result[scoutKeys.isRemoteCandidate] = true
      }

      const claimScore = this.getClaimScore()
      result[scoutKeys.claimScore] = claimScore
    }

  }

  result[scoutKeys.lastScout] = Game.time
  return result
}

function findRemoteHost(remoteName) {
  for (const room of Overlord.myRooms) {
    if (room.memory.remotes && room.memory.remotes[remoteName]) {
      return room
    }
  }
  return undefined
}

Room.prototype.getAccessibleToController = function () {
  const controller = this.controller
  if (!controller) {
    return false
  }
  const exits = this.find(FIND_EXIT)
  const search = PathFinder.search(
    controller.pos, exits, {
    maxRooms: 1,
    maxOps: 10000,
    roomCallback: function (roomName) {
      const room = Game.rooms[roomName]
      if (room) {
        return room.basicCostmatrix
      }
    }
  }
  )
  return !search.incomplete
}

Room.prototype.acquireVision = function (roomName) {
  const observer = this.structures.observer[0]
  if (observer && Game.map.getRoomLinearDistance(this.name, roomName) <= 10) {
    observer.observeRoom(roomName)
    return ERR_NOT_FOUND
  }

  const scouters = Overlord.getCreepsByRole(this.name, 'scouter')
  const scouter = scouters[0]

  if (!scouter) {
    this.requestScouter()
    return ERR_NOT_FOUND
  }

  if (scouter.spawning) {
    return ERR_NOT_FOUND
  }

  if (scouter.room.name !== roomName) {
    const result = scouter.moveToRoom(roomName, 1)
    if (result === ERR_NO_PATH) {
      return ERR_NO_PATH
    }
    return ERR_NOT_FOUND
  }
}

Room.prototype.getClaimScore = function () {
  const terrain = new Room.Terrain(this.name)

  let numSwamp = 0
  let numWall = 0
  let numPlain = 0

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      switch (terrain.get(x, y)) {
        case TERRAIN_MASK_WALL:
          numWall++
          break;
        case TERRAIN_MASK_SWAMP:
          numSwamp++
          break;
        case 0:
          numPlain++
          break;
      }
    }
  }

  const swampRatio = numSwamp / (numSwamp + numPlain)

  const swampScore = Math.clamp((0.5 - swampRatio) / 0.5, 0, 1)

  const numSource = this.find(FIND_SOURCES).length

  const sourceScore = numSource >= 2 ? 1 : 0

  const mineralTypes = this.find(FIND_MINERALS).map(mineral => mineral.mineralType)

  const mineralCount = getMineralCount()

  // U, K, L , Z : O : H : X = 1:5:3:3

  let mineralScore = 0

  for (const mineralType of mineralTypes) {
    let mineralTypeScore = 1 / (mineralCount[mineralType] + 1)
    if (mineralType === 'O') {
    } else if (['X', 'H'].includes(mineralType)) {
      mineralScore *= (3 / 5)
    } else {
      mineralScore *= 1 / 5
    }
    mineralScore += mineralTypeScore
  }

  const closestRangeToMyRoom = Math.min(...Overlord.myRooms.map(room => Game.map.getRoomLinearDistance(room.name, this.name)))

  const rangeScore = Math.min(1, 0.5 * (closestRangeToMyRoom - 1))

  const adjacentRoomNames = Overlord.getAdjacentRoomNames(this.name)

  let remoteSourceLength = 0
  for (const roomName of adjacentRoomNames) {
    const intel = Overlord.getIntel(roomName)
    if (intel && intel[scoutKeys.isRemoteCandidate]) {
      remoteSourceLength += intel[scoutKeys.numSource]
    }
  }

  const remoteScore = Math.clamp(0.25 * (remoteSourceLength - 3), 0, 1)

  return Math.floor((swampScore + sourceScore + mineralScore + rangeScore + remoteScore) * 20) / 100
}

function getMineralCount() {
  const myRooms = Overlord.myRooms
  const result = {}

  for (const mineralType of BASIC_MINERALS) {
    result[mineralType] = 0
  }

  for (const room of myRooms) {
    const minerals = room.find(FIND_MINERALS)
    for (const mineral of minerals) {
      const mineralType = mineral.mineralType
      result[mineralType] = result[mineralType] || 0
      result[mineralType]++
    }
  }

  return result
}

Room.prototype.checkHighway = function () {
  const intel = Overlord.getIntel(this.name)

  if (intel && (intel[scoutKeys.threat] || 0) > Game.time) {
    return
  }

  const doTask = config.task

  if (doTask.deposit) {
    Overlord.checkDeposits(this.name)
  }

  if (doTask.powerBank) {
    Overlord.checkPowerBanks(this.name)
  }
}

Room.prototype.cachePortals = function () {
  this.memory.portalInfo = {}

  const portals = this.structures.portal

  for (const portal of portals) {
    const portalPosPacked = packCoord(portal.pos.x, portal.pos.y)

    const destination = portal.destination

    const shard = destination.shard

    const destinationPosPacked = destination.roomName ? packCoord(destination.x, destination.y) : undefined

    const roomName = shard ? destination.room : destination.roomName

    // interRoom: shard undefined. packed defined
    // interShard: shard defined. packed undefined
    const portalInfo = { shard, roomName, packed: destinationPosPacked }

    this.memory.portalInfo[portalPosPacked] = portalInfo
  }
}

Room.prototype.cacheResourceInfo = function () {
  this.memory.resourceInfo = {}
  const sources = this.find(FIND_SOURCES)
  const minerals = this.find(FIND_MINERALS)

  const sourceInfo = this.memory.resourceInfo.sources = []
  for (const source of sources) {
    const packed = packCoord(source.pos.x, source.pos.y)
    sourceInfo.push({ packed })
  }

  const mineralInfo = this.memory.resourceInfo.minerals = []
  for (const mineral of minerals) {
    const packed = packCoord(mineral.pos.x, mineral.pos.y)
    const resourceType = mineral.mineralType
    mineralInfo.push({ packed, resourceType })
  }
}
const SCOUT_INTERVAL_UNDER_RCL_8 = 6000 // scout 시작 후 얼마나 지나야 리셋할건지 1000보다 커야함.
const SCOUT_INTERVAL_AT_RCL_8 = 2000

const SCOUT_DECAY = 10000

const DISTANCE_TO_DEPOSIT_MINING = 5

Room.prototype.manageScout = function () {
  const MAX_DISTANCE = (SHARD === 'swc') ? 20 : 10 // 최대 거리

  this.memory.scout = this.memory.scout || {}
  const status = this.memory.scout
  status.cache = status.cache || {}

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
    status.cache[this.name] = true
    status.state = 'BFS'
    return
  }

  if (status.state === 'BFS') {
    if (status.adjacents && status.adjacents.length > 0) {
      while (status.adjacents.length > 0) {
        status.next = status.adjacents.shift()
        status.state = 'scout'
        return
      }
    }

    while (status.queue.length > 0) {
      const node = status.queue.shift()
      const intel = Overlord.getIntel(node)
      const distance = Game.map.getRoomLinearDistance(this.name, node)
      if (distance > MAX_DISTANCE) {
        continue
      }

      if (intel.inaccessible && intel.inaccessible > Game.time) {
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

        if (getRoomType(roomName) === 'sourceKeeper') {
          return false
        }

        // 이미 본 거면 제외
        if (status.cache[roomName]) {
          return false
        }

        return true
      })

      while (status.adjacents.length > 0) {
        status.next = status.adjacents.shift()
        status.state = 'scout'
        return
      }
    }
    status.state = 'wait'
    return
  }

  if (status.state === 'scout') {
    const roomName = status.next
    const intel = Overlord.getIntel(status.next)

    if (Game.map.getRoomLinearDistance(this.name, roomName) <= 2) {
      const room = Game.rooms[roomName]
      if (!room || !intel) {
        this.acquireVision(roomName)
        return
      }

      if (intel.isRemoteCandidate) {
        this.tryRemote(roomName)
      }
    }

    // success
    if (intel.lastScout && (Game.time < intel.lastScout + scoutInterval)) {

      status.cache[roomName] = true
      status.queue.push(roomName)
      delete status.next

      status.state = 'BFS'
      return
    }
    const result = this.acquireVision(status.next)

    // failure
    if (result === ERR_NO_PATH) {
      status.cache[status.next] = true
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

Room.prototype.resetScout = function () {
  const map = Overlord.map
  for (const roomName of Object.keys(map)) {
    if (map[roomName].host && map[roomName].host === this.name) {
      delete map[roomName]
    }
  }

  delete this.memory.scout
  const scouters = Overlord.getCreepsByRole(this.name, 'scouter')
  for (const scouter of scouters) {
    scouter.suicide()
  }
}

Room.prototype.updateIntel = function () {
  const intelBefore = this.memory.intel || {}

  if (intelBefore.lastScout && (Game.time < intelBefore.lastScout + 1000)) {
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

  const intelNew = this.analyzeIntel()

  const intel = { ...intelBefore, ...intelNew }

  this.memory.intel = intel
}

Room.prototype.tryRemote = function (roomName) {
  const intel = Overlord.getIntel(roomName)

  // not adequate
  if (!intel.isRemoteCandidate) {
    return
  }

  // already my remote
  if (this.memory.remotes && Object.keys(this.memory.remotes).includes(roomName)) {
    return
  }

  const roomBefore = findRemoteHost(roomName)

  // no competition
  if (!roomBefore || roomBefore.controller.level < 7 && this.controller.level <= 7) {
    const infraPlan = this.getRemoteInfraPlan(roomName)

    if (infraPlan === ERR_NOT_FOUND) {
      this.deleteRemote(roomName)
      return
    }

    data.recordLog(`REMOTE: Not my remote. Colonize ${roomName}`, this.name)
    colonize(roomName, this.name)
    return
  }


  // competition

  const statusBefore = roomBefore.getRemoteStatus(roomName)

  const infraPlan = this.getRemoteInfraPlan(roomName)

  // cannot find infraPlan
  if (infraPlan === ERR_NOT_FOUND) {
    this.deleteRemote(roomName)
    return
  }

  if (!statusBefore || !statusBefore.infraPlan) {

    data.recordLog(`REMOTE: No status. Abandon remote ${roomName}`, roomBefore.name)
    roomBefore.deleteRemote(roomName)

    data.recordLog(`REMOTE: Colonize ${roomName} with distance ${info.distance}`, this.name)
    colonize(roomName, this.name)
    return
  }

  // compare

  const statusNow = this.getRemoteStatus(roomName)

  if (!statusNow) {
    this.deleteRemote(roomName)
    return
  }

  if (Object.keys(statusNow.infraPlan).length < Object.keys(statusBefore.infraPlan).length) {
    this.deleteRemote(roomName)
    return
  }

  const totalPathLengthBefore = Object.values(statusBefore.infraPlan).map(value => value.pathLength).reduce((acc, curr) => acc + curr, 0)
  const totalPathLengthNow = Object.values(statusNow.infraPlan).map(value => value.pathLength).reduce((acc, curr) => acc + curr, 0)

  // compare
  if (totalPathLengthBefore <= totalPathLengthNow) {
    this.deleteRemote(roomName)
    return
  }

  data.recordLog(`REMOTE: Abandon remote ${roomName}. Less efficient than ${this.name}`, roomBefore.name)
  roomBefore.deleteRemote(roomName)

  data.recordLog(`REMOTE: Colonize ${roomName} with distance ${info.distance}`, this.name)
  colonize(roomName, this.name)

  return
}

Room.prototype.analyzeIntel = function () {
  const result = {}

  result.numSource = this.find(FIND_SOURCES).length
  result.mineralType = this.mineral ? this.mineral.mineralType : undefined

  const isController = (this.controller !== undefined)
  if (isController) {
    const owner = this.controller.owner
    result.isAccessibleToContorller = this.getAccessibleToController()

    if (owner) {
      const username = owner.username

      result.owner = username
      result.RCL = this.controller.level
      result.isAlly = allies.includes(username)
      result.isMy = (username === MY_NAME)
      result.isEnemy = ((!result.isAlly) && (!result.isMy))
      result.numTower = this.structures.tower.filter(tower => tower.RCLActionable).length
    }

    result.isMyRemote = Overlord.remotes.includes(this.name)

    const reservation = this.controller.reservation
    if (reservation) {
      const username = reservation.username

      result.reservationOwner = username
      result.isAllyRemote = allies.includes(username)
    }

    if (result.isAccessibleToContorller && !result.owner) {
      if (!result.isAllyRemote && (result.numSource > 0)) {
        result.isRemoteCandidate = true
      }

      const claimScore = this.getClaimScore()
      result.claimScore = claimScore
    }

  }

  result.lastScout = Game.time
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
  return 0
}

Room.prototype.checkHighway = function () {
  const intel = Overlord.getIntel(this.name)

  if (intel && (intel.threat || 0) > Game.time) {
    return
  }

  Overlord.checkDeposits(this.name)

  if (SHARD === 'swc') {
    return
  }

  Overlord.checkPowerBanks(this.name)
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
    const packed = packCoord(source.pos)
    sourceInfo.push({ packed })
  }

  const mineralInfo = this.memory.resourceInfo.minerals = []
  for (const mineral of minerals) {
    const packed = packCoord(mineral.pos)
    const resourceType = mineral.mineralType
    mineralInfo.push({ packed, resourceType })
  }
}
const { MapUtil } = require('./util_map')
const MinHeap = require('./util_min_heap')

const AVOID_SOURCE_KEEPER_RANGE = 6

Overlord.findMyRoomsInRange = function (fromRoomName, range) {
  const myRooms = this.myRooms
  const myRoomsFiltered = myRooms.filter((room) => {
    if (Game.map.getRoomLinearDistance(fromRoomName, room.name) > range) {
      return false
    }
    return true
  })
  return myRoomsFiltered
}

Overlord.findClosestRoom = function (fromRoomName, roomNames, maxRooms = 16) {
  return MapUtil.findClosestBySafeRoute(fromRoomName, (roomName) => roomNames.includes(roomName), maxRooms)
}

Overlord.findClosestMyRoom = function (fromRoomName, level = 0, maxRooms = 16) {
  const closestMyRoomName = MapUtil.findClosestBySafeRoute(
    fromRoomName,
    (roomName) => {
      const room = Game.rooms[roomName]
      if (!room || !room.isMy || room.controller.level < level) {
        return false
      }
      return true
    },
    maxRooms
  )
  return Game.rooms[closestMyRoomName]
}

Overlord.findRouteLength = function (route) {
  if (!Array.isArray(route)) {
    return Infinity
  }
  return route.map((segment) => segment.length).reduce((acc, curr) => acc + curr, 0)
}

Overlord.findPath = function (startPos, goals, options = {}) {
  const defaultOptions = { ignoreCreeps: true, staySafe: false, ignoreMap: 1, moveCost: 0.5, route: undefined }

  const mergedOptions = { ...defaultOptions, ...options }

  const { ignoreCreeps, staySafe, ignoreMap, moveCost, route } = mergedOptions

  const mainTargetPos = goals[0].pos
  const targetRoomName = mainTargetPos.roomName

  const maxRooms = startPos.roomName === targetRoomName ? 1 : 16

  let routes = undefined
  if (route) {
    routes = [route]
  } else {
    routes = [[startPos.roomName]]
    if (maxRooms > 1) {
      const intel = Overlord.getIntel(targetRoomName)
      if (ignoreMap === 0 && intel[scoutKeys.inaccessible] && intel[scoutKeys.inaccessible] > Game.time) {
        console.log(`inaccessible ${startPos}`)
        return ERR_NO_PATH
      }
      routes = this.findRoute(startPos.roomName, targetRoomName)
    }

    if (routes === ERR_NO_PATH) {
      console.log(`${startPos}`)
      return ERR_NO_PATH
    }
  }

  const startRoomName = startPos.roomName
  const startRoom = Game.rooms[startRoomName]

  const result = []
  let posNow = startPos
  while (routes.length > 0) {
    const routeNow = routes.shift()
    const routeNowLastRoomName = routeNow[routeNow.length - 1]

    const routeNext = routes[0]
    const toPortal = !!routeNext

    const goalsNow = toPortal > 0 ? getPortalPositions(routeNowLastRoomName, routeNext[0]) : goals

    const maxRoomsNow = routeNow.length

    const search = PathFinder.search(posNow, goalsNow, {
      plainCost: Math.max(1, Math.ceil(2 * Number(moveCost))),
      swampCost: Math.max(1, Math.ceil(10 * Number(moveCost))),
      heuristicWeight: 1.01,
      roomCallback: function (roomName) {
        // route에 있는 방만 써라
        if (routeNow !== undefined && !routeNow.includes(roomName)) {
          return false
        }

        // 방 보이는지 확인
        const room = Game.rooms[roomName]

        // 방 안보이면 기본 CostMatrix 쓰자
        if (!room) {
          const costs = new PathFinder.CostMatrix()

          const roomType = getRoomType(roomName)

          if (roomType === 'highway' || roomType === 'center') {
            const memory = Memory.rooms[roomName]
            if (memory && memory.portalInfo) {
              const portalPositions = Object.keys(memory.portalInfo)
              for (const packed of portalPositions) {
                const parsed = parseCoord(packed)
                costs.set(parsed.x, parsed.y, 255)
              }
            }
          }

          if (roomType === 'sourceKeeper') {
            const memory = Memory.rooms[roomName]
            if (memory && memory.resourceInfo) {
              for (const infos of Object.values(memory.resourceInfo)) {
                for (const info of infos) {
                  const packed = info.packed
                  const parsed = parseCoord(packed)
                  const x = parsed.x
                  const y = parsed.y
                  const minX = Math.clamp(x - AVOID_SOURCE_KEEPER_RANGE, 0, 49)
                  const maxX = Math.clamp(x + AVOID_SOURCE_KEEPER_RANGE, 0, 49)
                  const minY = Math.clamp(y - AVOID_SOURCE_KEEPER_RANGE, 0, 49)
                  const maxY = Math.clamp(y + AVOID_SOURCE_KEEPER_RANGE, 0, 49)
                  for (let i = minX; i <= maxX; i++) {
                    for (let j = minY; j <= maxY; j++) {
                      costs.set(i, j, 254)
                    }
                  }
                }
              }
            }
          }
          return costs
        }

        // staySafe가 true면 defenseCostMatrix 사용. 아니면 basicCostmatrix 사용.
        const costs = room.isMy && staySafe ? room.defenseCostMatrix.clone() : room.basicCostmatrix.clone()
        // 방 보이고 ignoreCreeps가 false고 지금 이 방이 creep이 있는 방이면 creep 위치에 cost 255 설정
        if (!ignoreCreeps && startRoomName === roomName) {
          const creepCost = ignoreCreeps === false ? 255 : ignoreCreeps
          for (const creep of startRoom.find(FIND_CREEPS)) {
            costs.set(creep.pos.x, creep.pos.y, creepCost)
          }
          for (const powerCreep of startRoom.find(FIND_POWER_CREEPS)) {
            costs.set(powerCreep.pos.x, powerCreep.pos.y, creepCost)
          }
        }
        return costs
      },
      maxRooms: maxRoomsNow,
      maxOps: maxRoomsNow > 1 ? 60000 : 5000,
    })

    if (search.incomplete) {
      return ERR_NO_PATH
    }

    result.push(...search.path)

    if (toPortal) {
      const portalInfo = Memory.rooms[routeNowLastRoomName].portalInfo
      const lastPos = result[result.length - 1] || posNow

      for (const pos of lastPos.getAtRange(1)) {
        const packed = packCoord(pos.x, pos.y)
        const info = portalInfo[packed]
        if (!info) {
          continue
        }
        if (info.shard) {
          continue
        }
        const parsed = parseCoord(info.packed)
        const destination = new RoomPosition(parsed.x, parsed.y, info.roomName)
        result.push(pos)
        posNow = destination
      }
    }
  }

  return result
}

function getPortalPositions(roomName, toRoomName) {
  const memory = Memory.rooms[roomName]
  if (!memory) {
    return []
  }
  const portalInfo = memory.portalInfo
  if (!portalInfo) {
    return []
  }
  const positions = []
  for (const packed in portalInfo) {
    const destinationRoomName = portalInfo[packed].roomName
    if (destinationRoomName !== toRoomName) {
      continue
    }
    const parsed = parseCoord(packed)
    const pos = new RoomPosition(parsed.x, parsed.y, roomName)
    positions.push(pos)
  }
  return positions.map((pos) => {
    return { pos, range: 1 }
  })
}

Overlord.findRoute = function (startRoomName, goalRoomName, options) {
  const normal = this.findRouteWithoutPortal(startRoomName, goalRoomName, options)

  if (normal) {
    return normal
  }

  return this.findRoutesWithPortal(startRoomName, goalRoomName, options)
}

Overlord.findRouteWithoutPortal = function (startRoomName, goalRoomName, options) {
  const defaultOptions = { maxRooms: 16 }
  const mergedOptions = { ...defaultOptions, ...options }
  const { maxRooms } = mergedOptions

  const findRoute = Game.map.findRoute(startRoomName, goalRoomName, {
    routeCallback(roomName) {
      return getRoomCost(startRoomName, goalRoomName, roomName)
    },
  })

  if (findRoute === ERR_NO_PATH || Object.keys(findRoute).length > maxRooms) {
    return false
  }
  return [[startRoomName, ...findRoute.map((info) => info.room)]]
}

Overlord.findRoutesWithPortal = function (startRoomName, goalRoomName, options) {
  const defaultOptions = { maxRooms: 16 }
  const mergedOptions = { ...defaultOptions, ...options }
  const { maxRooms } = mergedOptions

  const costs = {}
  costs[startRoomName] = 0

  const previous = []
  const queue = new MinHeap((roomName) => costs[roomName])
  const portalSet = {}
  const depthCache = {}
  depthCache[startRoomName] = 0

  queue.insert(startRoomName)

  const cpuBefore = Game.cpu.getUsed()

  while (queue.getSize() > 0) {
    if (Game.cpu.getUsed() - cpuBefore > 10) {
      console.log(`Using too much cpu to find route from ${startRoomName} to ${goalRoomName}`)
      return ERR_NO_PATH
    }

    const current = queue.remove()
    const currentDepth = depthCache[current]

    if (current === goalRoomName) {
      break
    }

    const currentCost = costs[current]

    const neighbors = Object.values(Game.map.describeExits(current))
    const portalInfo = Memory.rooms[current] ? Memory.rooms[current].portalInfo : undefined
    const portalInfoValues = portalInfo ? Object.values(portalInfo) : undefined
    if (portalInfoValues && portalInfoValues.length > 0) {
      const info = portalInfoValues[0]
      const roomName = info.shard ? undefined : info.roomName
      if (roomName) {
        neighbors.push(roomName)
      }
      portalSet[current] = roomName
    }

    for (const neighbor of neighbors) {
      const cost = getRoomCost(startRoomName, goalRoomName, neighbor)
      if (cost === Infinity) {
        continue
      }

      const afterCost = currentCost + cost

      const beforeCost = costs[neighbor] !== undefined ? costs[neighbor] : Infinity

      if (afterCost < beforeCost) {
        costs[neighbor] = afterCost
        previous[neighbor] = current
        depthCache[neighbor] = currentDepth + 1
        if (depthCache[neighbor] < maxRooms) {
          queue.insert(neighbor)
        }
      }
    }
  }

  if (!previous[goalRoomName]) {
    return ERR_NO_PATH
  }

  let now = goalRoomName
  const result = [[goalRoomName]]

  while (true) {
    const prev = previous[now]

    if (!prev) {
      break
    }

    if (portalSet[prev] === now) {
      result.unshift([prev])
      now = prev
      continue
    }
    result[0].unshift(prev)
    now = prev
  }
  return result
}

Overlord.getAdjacentRoomNames = function (roomName) {
  const adjacents = Object.values(Game.map.describeExits(roomName))
  const portalInfo = Memory.rooms[roomName] ? Memory.rooms[roomName].portalInfo : undefined
  if (portalInfo) {
    const portals = Object.values(portalInfo)
    const roomName = portals[0] ? portals[0].roomName : undefined
    const shard = portals[0] ? portals[0].shard : undefined
    if (roomName && !shard) {
      adjacents.push(roomName)
    }
  }
  return adjacents
}

function getRoomCost(startRoomName, goalRoomName, roomName) {
  if (roomName === startRoomName) {
    return 1
  }

  if (roomName === goalRoomName) {
    return 1
  }

  const status = Game.map.getRoomStatus(roomName)
  if (status && status.status !== 'normal') {
    return Infinity
  }

  const intel = Overlord.getIntel(roomName)

  if (intel[scoutKeys.isMy]) {
    return 1
  }

  if (allies.includes(intel[scoutKeys.owner])) {
    return 1
  }

  if (intel[scoutKeys.numTower] > 0) {
    return Infinity
  }

  if (Game.time < intel[scoutKeys.inaccessible]) {
    return 3.1
  }

  if (Overlord.remotes.includes(roomName)) {
    return 1
  }

  const roomType = getRoomType(roomName)

  if (roomType === 'highway' || roomType === 'center') {
    return 1
  }

  if (roomType === 'sourceKeeper') {
    return 1.2
  }

  return 1.1
}

Overlord.getIntel = function (roomName) {
  Memory.rooms[roomName] = Memory.rooms[roomName] || {}
  Memory.rooms[roomName].intel = Memory.rooms[roomName].intel || {}
  return Memory.rooms[roomName].intel
}

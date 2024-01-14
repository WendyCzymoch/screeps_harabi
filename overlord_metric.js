const MinHeap = require("./util_min_heap")

Overlord.findMyRoomsInRange = function (fromRoomName, range) {
  const myRooms = this.myRooms
  const myRoomsFiltered = myRooms.filter(room => {
    if (Game.map.getRoomLinearDistance(fromRoomName, room.name) > range) {
      return false
    }
    return true
  })
  return myRoomsFiltered
}

Overlord.findClosestRoom = function (fromRoomName, roomNames, ignoreMap = 1, maxRooms = 16) {
  const routeLenthCache = {}
  const roomNamesFiltered = roomNames.filter(roomName => {
    const route = this.findRoutesWithPortal(fromRoomName, roomName, ignoreMap)
    if (!Array.isArray(route)) {
      return false
    }
    const length = route.map(segment => segment.length).reduce((acc, curr) => acc + curr, 0)
    if (length > maxRooms) {
      return false
    }
    routeLenthCache[roomName] = length
    return true
  })

  if (roomNamesFiltered.length === 0) {
    return undefined
  }

  const roomNamesSorted = roomNamesFiltered.sort((a, b) => {
    const lengthA = routeLenthCache[a]
    const lengthB = routeLenthCache[b]
    return lengthA - lengthB
  })
  return roomNamesSorted[0]
}

Overlord.findClosestMyRoom = function (fromRoomName, level = 0, ignoreMap = 1, maxRooms = 16) {
  const myRooms = Overlord.myRooms
  const routeLenthCache = {}
  const myRoomsFiltered = myRooms.filter(room => {
    if (room.controller.level < level) {
      return false
    }
    const route = this.findRoutesWithPortal(fromRoomName, room.name, ignoreMap)
    if (!Array.isArray(route)) {
      return false
    }
    const length = route.map(segment => segment.length).reduce((acc, curr) => acc + curr, 0)
    if (length > maxRooms) {
      return false
    }
    routeLenthCache[room.name] = length
    return true
  })
  const myRoomsSorted = myRoomsFiltered.sort((a, b) => {
    const lengthA = routeLenthCache[a.name]
    const lengthB = routeLenthCache[b.name]
    return lengthA - lengthB
  })
  return myRoomsSorted[0]
}

Overlord.findPath = function (startPos, goals, options = {}) {
  const defaultOptions = { ignoreCreeps: true, staySafe: false, ignoreMap: 1, visualize: false, moveCost: 0.5 }

  const mergedOptions = { ...defaultOptions, ...options }

  const { ignoreCreeps, staySafe, ignoreMap, visualize, moveCost } = mergedOptions

  const mainTargetPos = goals[0].pos
  const targetRoomName = mainTargetPos.roomName

  const maxRooms = startPos.roomName === targetRoomName ? 1 : 16

  let routes = [[startPos.roomName]]
  if (maxRooms > 1) {
    const intel = Overlord.getIntel(targetRoomName)
    if (ignoreMap === 0 && intel.inaccessible && intel.inaccessible > Game.time) {
      return ERR_NO_PATH
    }

    routes = this.findRoutesWithPortal(startPos.roomName, targetRoomName, ignoreMap)
  }

  if (routes === ERR_NO_PATH) {
    return ERR_NO_PATH
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
      plainCost: Math.max(1, Math.ceil(2 * moveCost)),
      swampCost: Math.max(1, Math.ceil(10 * moveCost)),
      roomCallback: function (roomName) {
        // route에 있는 방만 써라
        if (routeNow !== undefined && !routeNow.includes(roomName)) {
          return false
        }

        // 방 보이는지 확인
        const room = Game.rooms[roomName]

        // 방 안보이면 기본 CostMatrix 쓰자
        if (!room) {
          const costs = new PathFinder.CostMatrix

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

          if (roomType === 'center' || roomType === 'sourceKeeper') {
            const memory = Memory.rooms[roomName]
            if (memory && memory.resourceInfo) {
              for (const infos of Object.values(memory.resourceInfo)) {
                for (const info of infos) {
                  const packed = info.packed
                  const parsed = parseCoord(packed)
                  const x = parsed.x
                  const y = parsed.y
                  const minX = Math.clamp(x - 5, 0, 49)
                  const maxX = Math.clamp(x + 5, 0, 49)
                  const minY = Math.clamp(y - 5, 0, 49)
                  const maxY = Math.clamp(y + 5, 0, 49)
                  for (let i = minX; i < maxX; i++) {
                    for (let j = minY; j < maxY; j++) {
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
        const costs = ((startRoomName === roomName) && staySafe) ? room.defenseCostMatrix.clone() : room.basicCostmatrix.clone()
        // 방 보이고 ignoreCreeps가 false고 지금 이 방이 creep이 있는 방이면 creep 위치에 cost 255 설정
        if (ignoreCreeps !== true && startRoomName === roomName) {
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
      maxOps: maxRoomsNow > 1 ? 40000 : 5000
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
  return positions.map(pos => { return { pos, range: 1 } })
}

Overlord.findRoutesWithPortal = function (startRoomName, goalRoomName, ignoreMap = 1) {
  const costs = {}
  costs[startRoomName] = 0

  const previous = []
  const queue = new MinHeap(roomName => costs[roomName])
  const portalSet = {}

  queue.insert(startRoomName)

  while (queue.getSize() > 0) {
    if (Game.cpu.getUsed() > 500) {
      return ERR_NO_PATH
    }

    const current = queue.remove()

    if (current === goalRoomName) {
      break
    }

    const currentCost = costs[current]

    if (currentCost > 25) {
      return ERR_NO_PATH
    }

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
      const cost = getRoomCost(startRoomName, goalRoomName, neighbor, ignoreMap)
      const afterCost = currentCost + cost
      const beforeCost = costs[neighbor] !== undefined ? costs[neighbor] : Infinity
      if (afterCost < beforeCost) {
        costs[neighbor] = afterCost
        previous[neighbor] = current
        queue.insert(neighbor)
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

function getRoomCost(startRoomName, goalRoomName, roomName, ignoreMap = 1) {

  if (roomName === startRoomName) {
    return 1
  }
  if (ignoreMap >= 1 && roomName === goalRoomName) {
    return 1
  }

  Overlord.heap.roomCost = Overlord.heap.roomCost || {}

  if (Overlord.heap.roomCost[roomName] && Math.random() < 0.9) {
    return Overlord.heap.roomCost[roomName]
  }

  const room = Game.rooms[roomName]

  if (room && (room.isMy || room.isMyRemote)) {
    return Overlord.heap.roomCost[roomName] = 1
  }

  const intel = Overlord.getIntel(roomName)

  if (allies.includes(intel.owner)) {
    return Overlord.heap.roomCost[roomName] = 1
  }

  const inaccessible = intel.inaccessible
  if (ignoreMap < 2 && inaccessible && inaccessible > Game.time) {
    return Overlord.heap.roomCost[roomName] = Infinity
  }

  if (intel.numTower) {
    return Overlord.heap.roomCost[roomName] = Infinity
  }

  const status = Overlord.getRoomStatus(roomName)

  if (status && status.status !== 'normal') {
    return Overlord.heap.roomCost[roomName] = Infinity
  }

  const roomType = getRoomType(roomName)

  if (roomType === 'highway') {
    return Overlord.heap.roomCost[roomName] = 1
  }

  return Overlord.heap.roomCost[roomName] = 2.5
}

Overlord.getIntel = function (roomName) {
  Memory.rooms[roomName] = Memory.rooms[roomName] || {}
  Memory.rooms[roomName].intel = Memory.rooms[roomName].intel || {}
  return Memory.rooms[roomName].intel
}

Overlord.getRoomStatus = function (roomName) {
  const intel = this.getIntel(roomName)
  if (intel.roomStatus && intel.roomStatusTime && Game.time < intel.roomStatusTime + 10000) {
    return intel.roomStatus
  }

  intel.roomStatusTime = Game.time
  return intel.roomStatus = Game.map.getRoomStatus(roomName)
}
const MinHeap = require('./util_min_heap')

class MapUtil {
  constructor() {}

  roomNameToCoord(roomName) {
    const quad = roomName.match(/[NSEW]/g)
    const coords = roomName.match(/[0-9]+/g)
    const x = Number(coords[0])
    const y = Number(coords[1])
    return { x: quad[0] === 'W' ? -1 - x : x, y: quad[1] === 'S' ? -1 - y : y }
  }

  roomCoordToName(roomCoord) {
    const x = roomCoord.x
    const y = roomCoord.y
    return (x < 0 ? 'W' + String(-x - 1) : 'E' + String(x)) + (y < 0 ? 'S' + String(-y - 1) : 'N' + String(y))
  }

  getRoomNamesInRange(roomName, distance) {
    const size = 2 * distance + 1

    const roomCoord = this.roomNameToCoord(roomName)

    const minX = roomCoord.x - distance

    const minY = roomCoord.y - distance

    const result = []

    for (let x = minX; x < minX + size; x++) {
      for (let y = minY; y < minY + size; y++) {
        result.push(this.roomCoordToName({ x, y }))
      }
    }

    return result
  }

  /**
   *
   * @param {string} roomName
   * @param {Function} roomCallback function that checks if a room is we are looking for.
   *                                only one argument (roomName) is accepted
   */
  findClosestBySafeRoute(roomName, roomCallback, maxDepth = 10) {
    const depthCache = {}
    depthCache[roomName] = 0
    const queue = [roomName]

    while (queue.length > 0) {
      const current = queue.shift()
      const depthCurrent = depthCache[current]
      const adjacents = Object.values(Game.map.describeExits(current))

      for (const adjacent of adjacents) {
        if (depthCache[adjacent] !== undefined) {
          continue
        }

        depthCache[adjacent] = depthCurrent + 1

        const status = Game.map.getRoomStatus(roomName)

        if (status && status.status !== 'normal') {
          continue
        }

        if (roomCallback(adjacent)) {
          console.log(`found ${adjacent}`)
          return adjacent
        }

        if (depthCache[adjacent] >= maxDepth) {
          continue
        }

        if (!this.isSafe(adjacent)) {
          continue
        }

        queue.push(adjacent)
      }
    }

    return undefined
  }

  isSafe(roomName) {
    const roomIntel = Overlord.getIntel(roomName)

    if (roomIntel[scoutKeys.isMy] || roomIntel[scoutKeys.isMyRemote]) {
      return true
    }

    const owner = roomIntel[scoutKeys.owner]
    if (owner && allies.includes(owner)) {
      return true
    }

    const reservationOwner = roomIntel[scoutKeys.reservationOwner]
    if (reservationOwner && allies.includes(reservationOwner)) {
      return true
    }

    if (roomIntel[scoutKeys.numTower] > 0) {
      return false
    }

    return true
  }
}

module.exports = {
  MapUtil: new MapUtil(),
}

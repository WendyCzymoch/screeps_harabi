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
}

module.exports = {
  MapUtil: new MapUtil(),
}

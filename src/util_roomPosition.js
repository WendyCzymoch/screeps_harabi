class RoomPostionUtils {
  constructor() {}

  static packCoord(pos) {
    const x = pos.x
    const y = pos.y
    const coord = 50 * y + x
    return coord
  }

  static packPos(pos) {
    const x = pos.x
    const y = pos.y
    const roomName = pos.roomName
    const coord = 50 * y + x
    return coord + roomName
  }
}

module.exports = {
  RoomPostionUtils,
}

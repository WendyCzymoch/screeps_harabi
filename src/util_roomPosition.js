class RoomPostionUtils {
  constructor() {}

  packPos(pos) {
    const x = pos.x
    const y = pos.y
    const roomName = pos.roomName
    const coord = 50 * y + x
    return coord + roomName
  }
}

Overlord.roomPositionUtils = new RoomPostionUtils()

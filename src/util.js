Math.clamp = function (value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function getRoomMemory(roomName) {
  Memory.rooms[roomName] = Memory.rooms[roomName] || {}
  return Memory.rooms[roomName]
}

module.exports = {
  getRoomMemory,
}
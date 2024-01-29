const { config } = require("./config")

Overlord.manageSourceKeeperMineralTasks = function () {
  const tasks = this.getTasksWithCategory('sourceKeeperMineral')

  for (const request of Object.values(tasks)) {
    const targetRoomName = request.roomName
    const roomInCharge = Game.rooms[request.roomNameInCharge]

    if (!roomInCharge) {
      data.recordLog(`SK_Mineral: stopped source keeper room mineral mining at ${targetRoomName}. no room in charge`, targetRoomName)
      this.deleteTask(request)
      return
    }

    if (request.completed === true) {
      data.recordLog(`SK_Mineral: ${roomInCharge.name} completed source keeper room mineral mining at ${targetRoomName}`, targetRoomName)
      this.deleteTask(request)
      return
    }

    roomInCharge.runSourceKeeperMineral(request)
  }
}

const sourceKeeperMineralRequest = function (room, targetRoomName) {
  const targetRoom = Game.rooms[targetRoomName]

  this.category = 'sourceKeeperMineral'
  this.id = targetRoomName

  this.roomName = targetRoomName

  if (!targetRoom) {
    return
  }

  const mineral = targetRoom.find(FIND_MINERALS)[0]

  this.mineralType = mineral.mineralType

  this.amount = mineral.mineralAmount

  this.available = mineral.pos.available

  this.roomNameInCharge = room.name
}

Room.prototype.runSourceKeeperMineral = function (request) {

}
const { getRemoteValue } = require("./room_manager_remote")

Overlord.manageBucket = function () {
  const averageCpu = this.getAverageCpu()

  if (Memory._manageBucketTime && Game.time < Memory._manageBucketTime + CREEP_LIFE_TIME) {
    return
  }
  Memory._manageBucketTime = Game.time

  if (!averageCpu) {
    return
  }

  const limitCpu = Game.cpu.limit

  if ((averageCpu / limitCpu) > 0.95 || Game.cpu.bucket < 9000) {
    this.removeRemote()
  } else if ((averageCpu / limitCpu) < 0.85) {
    this.addRemote()
  }
}

Overlord.getAverageCpu = function () {
  if (Game._avgCPU) {
    return Game._avgCPU
  }

  if (!Memory.stats || !Memory.stats.cpu) {
    return
  }

  if (Memory.globalReset && Game.time < Memory.globalReset + 10) {
    return
  }

  const lastCpu = Memory.stats.cpu.used
  if (lastCpu === undefined) {
    return
  }

  const alpha = 2 / (CREEP_LIFE_TIME + 1)

  Memory.averageCpu = Memory.averageCpu === undefined ? lastCpu : Memory.averageCpu * (1 - alpha) + lastCpu * alpha

  return Game._avgCPU = Memory.averageCpu
}

Overlord.removeRemote = function () {
  const worstRemote = this.getWorstRemote()
  if (!worstRemote) {
    return
  }
  const roomNameInCharge = worstRemote.roomNameInCharge
  const remoteName = worstRemote.remoteName
  const roomInCharge = Game.rooms[roomNameInCharge]
  if (!roomInCharge) {
    return
  }
  const remoteInfo = roomInCharge.getRemoteInfo(remoteName)
  if (!remoteInfo) {
    return
  }
  data.recordLog(`BUCKET: block ${remoteName} from ${roomNameInCharge}`, remoteName)
  remoteInfo.block = true
}

Overlord.getWorstRemote = function () {
  const myRooms = this.myRooms
  let result = undefined
  let roomNameInCharge = undefined
  for (const room of myRooms) {
    const activeRemotes = room.getActiveRemotes()
    for (const info of activeRemotes) {
      const remoteName = info.remoteName
      const remoteInfo = room.getRemoteInfo(remoteName)
      if (remoteInfo.block) {
        continue
      }
      if (result === undefined || (info.value / info.weight) < (result.value / result.weight)) {
        result = info
        roomNameInCharge = room.name
      }
    }
  }
  if (roomNameInCharge && result) {
    result.roomNameInCharge = roomNameInCharge
    return result
  }
}

Overlord.addRemote = function () {
  const bestRemote = this.getBestRemote()
  if (!bestRemote) {
    return
  }

  const roomNameInCharge = bestRemote.roomNameInCharge
  const roomInCharge = Game.rooms[roomNameInCharge]

  if (!roomInCharge) {
    return
  }

  const remoteName = bestRemote.remoteName

  const remoteInfo = roomInCharge.getRemoteInfo(remoteName)

  if (!remoteInfo) {
    return
  }

  data.recordLog(`BUCKET: add ${remoteName} from ${roomNameInCharge}`, remoteName)
  delete remoteInfo.block
}

Overlord.getBestRemote = function () {
  const myRooms = this.myRooms
  let score = undefined
  let result = undefined
  let roomNameInCharge = undefined
  for (const room of myRooms) {
    const remoteNames = room.getRemoteNames()
    for (const remoteName of remoteNames) {
      const info = room.getRemoteInfo(remoteName)
      if (!info.block) {
        continue
      }
      const value = getRemoteValue(room, remoteName)
      const weight = Math.ceil(room.getRemoteSpawnUsage(remoteName))
      if (!score || score < value / weight) {
        score = value / weight
        result = remoteName
        roomNameInCharge = room.name
      }
    }
  }
  if (roomNameInCharge && result) {
    return { roomNameInCharge, remoteName: result }
  }
}
const CPU_THRESHOLD_UP = 0.9
const CPU_THRESHOLD_DOWN = 0.8
const BUCKET_THRESHOLD = 9000
const CPU_INTERVAL = CREEP_LIFE_TIME / 3

Overlord.manageBucket = function () {
  const averageCpu = this.getAverageCpu()

  if (Memory._manageBucketTime && Game.time < Memory._manageBucketTime + CPU_INTERVAL) {
    return
  }

  if (!averageCpu) {
    return
  }

  Memory._manageBucketTime = Game.time

  const limitCpu = Game.cpu.limit

  if ((averageCpu / limitCpu) > CPU_THRESHOLD_UP || Game.cpu.bucket < BUCKET_THRESHOLD) {
    this.removeRemote()
  } else if ((averageCpu / limitCpu) < CPU_THRESHOLD_DOWN) {
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

  const alpha = 2 / (CPU_INTERVAL + 1)

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
  const remoteStatus = roomInCharge.getRemoteStatus(remoteName)
  if (!remoteStatus) {
    return
  }
  data.recordLog(`BUCKET: block ${remoteName} from ${roomNameInCharge}`, remoteName)
  remoteStatus.block = true
}

Overlord.getWorstRemote = function () {
  const myRooms = this.myRooms
  let result = undefined
  let roomNameInCharge = undefined
  for (const room of myRooms) {
    const activeRemotes = room.getActiveRemotes()
    for (const info of activeRemotes) {
      const remoteName = info.remoteName
      const remoteStatus = room.getRemoteStatus(remoteName)
      if (remoteStatus.block) {
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

  const remoteStatus = roomInCharge.getRemoteStatus(remoteName)

  if (!remoteStatus) {
    return
  }

  data.recordLog(`BUCKET: add ${remoteName} from ${roomNameInCharge}`, remoteName)
  delete remoteStatus.block
}

Overlord.getBestRemote = function () {
  const myRooms = this.myRooms
  let score = undefined
  let result = undefined
  let roomNameInCharge = undefined
  for (const room of myRooms) {
    const remoteNames = room.getRemoteNames()
    for (const remoteName of remoteNames) {
      const remoteStatus = room.getRemoteStatus(remoteName)
      if (!remoteStatus.block) {
        continue
      }
      const value = room.getRemoteValue(room, remoteName).total
      const weight = room.getRemoteSpawnUsage(remoteName).total
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
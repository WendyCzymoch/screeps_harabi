const { config } = require('./config')
const { ClaimRequest } = require('./overlord_tasks_claim')

Overlord.manageAutoClaim = function () {
  const numMyRooms = this.getNumMyRooms()

  if (Game.gcl.level <= numMyRooms) {
    return
  }

  const claimTasks = this.getTasksWithCategory('claim')
  if (Object.keys(claimTasks).length > 0) {
    return
  }

  const claimInfo = this.getClaimTargetInfo()

  if (claimInfo) {
    const base = Game.rooms[claimInfo.baseName]

    const targetRoomName = claimInfo.targetRoomName

    const request = new ClaimRequest(base, targetRoomName)

    Overlord.registerTask(request)
  }
}

Overlord.getClaimTargetInfo = function () {
  const nexts = Memory.nexts

  for (const next of nexts) {
    const nextRoom = Game.rooms[next]

    if (!nextRoom || !nextRoom.isMy) {
      const base = Overlord.findClosestMyRoom(next, 4, 12)

      if (base) {
        return { targetRoomName: next, baseName: base.name }
      }
    }
  }

  return this.getBestClaimInfo()
}

Overlord.getNumMyRooms = function () {
  let result = this.myRooms.length

  if (config.shards) {
    for (const shardName of config.shards) {
      if (shardName === Game.shard.name) {
        continue
      }
      const remoteMemory = JSON.parse(InterShardMemory.getRemote(shardName) || '{}')
      result += remoteMemory.numRooms || 0
    }
  }

  return result
}

Overlord.getBestClaimInfo = function () {
  let bestClaimInfo = undefined
  let bestScore = 0

  for (const roomName in Memory.rooms) {
    const intel = Overlord.getIntel(roomName)

    if (intel[scoutKeys.claimScore]) {
      if (Game.rooms[roomName] && Game.rooms[roomName].isMy) {
        delete intel[scoutKeys.claimScore]
        continue
      }

      if (intel[scoutKeys.claimScore] > bestScore) {
        const base = Overlord.findClosestMyRoom(roomName, 4, 12)

        if (!base) {
          continue
        }

        bestClaimInfo = { targetRoomName: roomName, baseName: base.name }
        bestScore = intel[scoutKeys.claimScore]
      }
    }
  }

  if (!bestClaimInfo) {
    return undefined
  }

  console.log(`${bestClaimInfo.targetRoomName} ${bestScore}`)

  return bestClaimInfo
}

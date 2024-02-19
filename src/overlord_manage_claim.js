const { config } = require('./config');

Overlord.getNumMyRooms = function () {
  let result = this.myRooms.length;

  if (config.shards) {
    for (const shardName of config.shards) {
      if (shardName === Game.shard.name) {
        continue;
      }
      const remoteMemory = JSON.parse(InterShardMemory.getRemote(shardName) || '{}');
      result += remoteMemory.numRooms || 0;
    }
  }

  return result;
};

Overlord.getBestRoom = function () {
  let bestRoomName = undefined;
  let bestScore = 0;

  for (const roomName in Memory.rooms) {
    const intel = Overlord.getIntel(roomName);

    if (intel[scoutKeys.claimScore]) {
      if (intel[scoutKeys.claimScore] > bestScore) {
        bestRoomName = roomName;
        bestScore = intel[scoutKeys.claimScore];
      }
    }
  }

  console.log(`${bestRoomName} ${bestScore}`);

  return bestRoomName;
};

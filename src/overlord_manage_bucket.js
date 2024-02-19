const CPU_THRESHOLD_UP = 0.95;
const CPU_THRESHOLD_DOWN = 0.85;
const BUCKET_THRESHOLD = 8000;
const CPU_INTERVAL = CREEP_LIFE_TIME;

Overlord.getBlockedRemoteNames = function () {
  const result = [];

  for (const remote of this.myRooms) {
    const remoteNames = remote.getRemoteNames();
    for (const remoteName of remoteNames) {
      const status = remote.getRemoteStatus(remoteName);
      if (status.block) {
        result.push(remoteName);
      }
    }
  }

  for (const remoteName of result) {
    console.log(remoteName);
  }

  return result;
};

Overlord.manageBucket = function () {
  const averageCpu = this.getAverageCpu();

  if (Memory._manageBucketTime && Game.time < Memory._manageBucketTime + CPU_INTERVAL) {
    return;
  }

  if (!averageCpu) {
    return;
  }

  Memory._manageBucketTime = Game.time;

  const limitCpu = Game.cpu.limit;

  const cpuThreshold = limitCpu * CPU_THRESHOLD_UP;

  if (averageCpu > cpuThreshold || Game.cpu.bucket < BUCKET_THRESHOLD) {
    const diff = averageCpu - cpuThreshold;
    const number = Math.clamp(Math.ceil(diff / 3), 1, Overlord.myRooms.length);
    this.removeRemote(number);
  } else if (averageCpu / limitCpu < CPU_THRESHOLD_DOWN) {
    this.addRemote();
  }
};

Overlord.getAverageCpu = function () {
  if (Game._avgCPU) {
    return Game._avgCPU;
  }

  if (!Memory.stats || !Memory.stats.cpu) {
    return;
  }

  if (Memory.globalReset && Game.time < Memory.globalReset + 10) {
    return;
  }

  const lastCpu = Memory.stats.cpu.used;

  if (lastCpu === undefined) {
    return;
  }

  const alpha = 2 / (CPU_INTERVAL + 1);

  Memory.averageCpu = Memory.averageCpu === undefined ? lastCpu : Memory.averageCpu * (1 - alpha) + lastCpu * alpha;

  return (Game._avgCPU = Memory.averageCpu);
};

Overlord.removeRemote = function (number = 1) {
  const worstRemotes = this.getWorstRemotes(number);

  for (const worstRemote of worstRemotes) {
    const roomNameInCharge = worstRemote.roomNameInCharge;

    const remoteName = worstRemote.remoteName;

    const roomInCharge = Game.rooms[roomNameInCharge];

    if (!roomInCharge) {
      return;
    }

    const remoteStatus = roomInCharge.getRemoteStatus(remoteName);

    if (!remoteStatus) {
      return;
    }

    data.recordLog(`BUCKET: block ${remoteName} from ${roomNameInCharge}`, remoteName);

    remoteStatus.block = true;
  }
};

Overlord.getWorstRemotes = function (number = 1) {
  const myRooms = this.myRooms;

  const candidates = [];
  for (const room of myRooms) {
    const activeRemotes = room.getActiveRemotes();
    for (const info of activeRemotes) {
      const remoteName = info.remoteName;
      const remoteStatus = room.getRemoteStatus(remoteName);
      if (remoteStatus.block) {
        continue;
      }
      const score = info.value / info.weight;
      const roomNameInCharge = room.name;
      const candidate = { roomNameInCharge, remoteName, score };
      candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  return candidates.slice(0, number);
};

Overlord.addRemote = function () {
  const bestRemote = this.getBestRemote();
  if (!bestRemote) {
    return;
  }

  const roomNameInCharge = bestRemote.roomNameInCharge;
  const roomInCharge = Game.rooms[roomNameInCharge];

  if (!roomInCharge) {
    return;
  }

  const remoteName = bestRemote.remoteName;

  const remoteStatus = roomInCharge.getRemoteStatus(remoteName);

  if (!remoteStatus) {
    return;
  }

  data.recordLog(`BUCKET: add ${remoteName} from ${roomNameInCharge}`, remoteName);
  delete remoteStatus.block;
};

Overlord.getBestRemote = function () {
  const myRooms = this.myRooms;
  let score = undefined;
  let result = undefined;
  let roomNameInCharge = undefined;
  for (const room of myRooms) {
    const remoteNames = room.getRemoteNames();
    for (const remoteName of remoteNames) {
      const remoteStatus = room.getRemoteStatus(remoteName);
      if (!remoteStatus.block) {
        continue;
      }
      const value = room.getRemoteValue(remoteName).total;
      const weight = room.getRemoteSpawnUsage(remoteName).total;
      if (!score || score < value / weight) {
        score = value / weight;
        result = remoteName;
        roomNameInCharge = room.name;
      }
    }
  }
  if (roomNameInCharge && result) {
    return { roomNameInCharge, remoteName: result };
  }
};

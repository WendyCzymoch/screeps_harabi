Overlord.manageMineralTasks = function () {
  const tasks = this.getTasksWithCategory("mineral");

  for (const request of Object.values(tasks)) {
    const targetRoomName = request.roomName;
    const roomInCharge = Game.rooms[request.roomNameInCharge];

    if (!roomInCharge) {
      data.recordLog(
        `MINERAL: stop MINERAL ${targetRoomName}. no room in charge`,
        targetRoomName
      );
      this.deleteTask(request);
      return;
    }

    if (request.completed === true) {
      data.recordLog(
        `MINERAL: ${roomInCharge.name} complete MINERAL ${targetRoomName}. result:${request.result}`,
        targetRoomName
      );
      this.deleteTask(request);
      return;
    }

    roomInCharge.runMineralTask(request);
    const color = resourceColor[request.mineralType];
    Game.map.visual.text(
      `${request.mineralType}`,
      new RoomPosition(25, 35, request.roomName),
      { color, opacity: 1, backgroundColor: "#000000" }
    );
    Game.map.visual.line(
      new RoomPosition(25, 25, roomInCharge.name),
      new RoomPosition(25, 25, request.roomName),
      { color, width: 2, opacity: 1 }
    );
  }
};

Room.prototype.runMineralTask = function (request) {
  const targetRoomName = request.roomName;

  const mineralId = request.mineralId;

  if (!isSourceKeeperHandler(request)) {
    const activeRemotes = this.getActiveRemotes();
    if (activeRemotes.find((info) => info.remoteName === targetRoomName)) {
      return;
    }
    const resourceIds = [mineralId];

    this.requestSourceKeeperHandler(targetRoomName, resourceIds);
    return;
  }

  if (!isMineralMiner(request)) {
    this.requestRemoteMiner(targetRoomName, mineralId, { maxWork: 32 });
    return;
  }
};

function isEnoughHaulers(request) {
  const targetRoomName = request.roomName;
  const mineralId = request.mineralId;
  const mineralHaulers = Overlord.getCreepsByRole(
    targetRoomName,
    "mineralHauler"
  ).filter((creep) => (creep.memory.sourceId = mineralId));

  for (const mineralHauler of mineralHaulers) {
    if (mineralHauler)
      if (
        mineralHauler.ticksToLive <
        mineralHauler.body.length * CREEP_SPAWN_TIME
      ) {
        return false;
      }
  }

  return false;
}

function isMineralMiner(request) {
  const targetRoomName = request.roomName;
  const mineralId = request.mineralId;
  const mineralMiners = Overlord.getCreepsByRole(
    targetRoomName,
    "remoteMiner"
  ).filter((creep) => (creep.memory.sourceId = mineralId));

  for (const mineralMiner of mineralMiners) {
    if (
      mineralMiner.ticksToLive >
      mineralMiner.body.length * CREEP_SPAWN_TIME + request.distance
    ) {
      return true;
    }
  }

  return false;
}

function isSourceKeeperHandler(request) {
  const targetRoomName = request.roomName;
  const mineralId = request.mineralId;
  const sourceKeeperHandlers = Overlord.getCreepsByRole(
    targetRoomName,
    "sourceKeeperHandler"
  );

  for (const sourceKeeperHandler of sourceKeeperHandlers) {
    if (
      sourceKeeperHandler.ticksToLive <
      sourceKeeperHandler.body.length * CREEP_SPAWN_TIME
    ) {
      continue;
    }
    if (sourceKeeperHandler.memory.resourceIds.includes(mineralId)) {
      return true;
    }
    sourceKeeperHandler.memory.resourceIds.push(mineralId);
    return true;
  }

  return false;
}

const MineralRequest = function (room, mineral) {
  const terminal = room.terminal;

  if (!terminal) {
    return;
  }

  const path = Overlord.findPath(mineral.pos, [
    { pos: terminal.pos, range: 1 },
  ]);

  if (path === ERR_NO_PATH) {
    return;
  }

  const distance = path.length;

  this.category = "mineral";
  this.id = mineral.id;

  this.roomName = mineral.room.name;

  this.mineralType = mineral.mineralType;

  this.mineralId = mineral.id;
  this.packedCoord = packCoord(mineral.pos.x, mineral.pos.y);
  this.lastCooldown = deposit.lastCooldown;
  this.mineralAmount = mineral.mineralAmount;
  this.distance = distance;

  this.roomNameInCharge = room.name;
  this.terminalId = terminal.id;
};

Room.prototype.requestMineralHauler = function (
  targetRoomName,
  sourceId,
  options = {}
) {
  if (!this.hasAvailableSpawn()) {
    return;
  }

  const body = [];
  let cost = 0;

  const name = `${targetRoomName} remoteHauler ${Game.time}_${this.spawnQueue.length}`;
  const memory = {
    role: "remoteHauler",
    base: this.name,
    targetRoomName,
    sourceId: sourceId,
  };

  if (options.constructing) {
    for (
      let i = 0;
      i < Math.min(Math.floor(this.energyCapacityAvailable / 550), 3);
      i++
    ) {
      body.push(WORK, WORK, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE);
      cost += 550;
    }

    memory.useRoad = true;
  } else if (options.noRoad) {
    const energyCapacity = this.energyCapacityAvailable;

    const maxCarry = options.maxCarry || 25;

    for (let i = 0; i < Math.min(maxCarry, 25); i++) {
      if (energyCapacity < cost + 100) {
        break;
      }
      body.push(CARRY, MOVE);
      cost += 100;
    }
  } else {
    memory.useRoad = true;

    if (options.isRepairer) {
      body.push(WORK, MOVE);
      cost += 150;
    }

    const energyCapacity = this.energyCapacityAvailable;

    const maxCarry = options.maxCarry || 32;

    for (let i = 0; i < Math.min(32, Math.ceil(maxCarry / 2)); i++) {
      if (energyCapacity < cost + 150) {
        break;
      }
      body.push(CARRY, CARRY, MOVE);
      cost += 150;
    }
  }

  const spawnOptions = {};
  spawnOptions.priority = SPAWN_PRIORITY["remoteHauler"];
  spawnOptions.cost = cost;

  if (options.isRepairer) {
    memory.isRepairer = true;
  }

  if (options.sourcePathLength) {
    memory.sourcePathLength = options.sourcePathLength;
  }

  if (options.keeperLairId) {
    memory.keeperLairId = options.keeperLairId;
  }

  const request = new RequestSpawn(body, name, memory, spawnOptions);
  this.spawnQueue.push(request);
};

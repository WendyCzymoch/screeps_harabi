const { getCombatInfo, GuardRequest } = require('./overlord_tasks_guard');
const { getBuilderModel } = require('./room_manager_spawn');
const { getRoomMemory } = require('./util');

const MAX_DISTANCE = 140;

const HAULER_RATIO = 0.4;
const SK_HAULER_RATIO = 0.6;
const SK_MINERAL_HAULER_RATIO = 0.2 + 0.1 + 0.2;

const RESERVATION_TICK_THRESHOLD = 1000;

const SOURCE_KEEPER_RANGE_TO_START_FLEE = 5;

const SOURCE_KEEPER_RANGE_TO_FLEE = 6;

const KEEPER_LAIR_RANGE_TO_START_FLEE = 7;

const KEEPER_LAIR_RANGE_TO_FLEE = 8;

const sourceKeeperHandlerBody = parseBody(`25m18a5h1a1h`);

Room.prototype.manageRemotes = function () {
  const activeRemotes = this.getActiveRemotes();

  const invaderStrengthThreshold = getInvaderStrengthThreshold(this.controller.level); // 1에서 100, 8에서 1644정도

  const remotesToSpawn = [];

  const canReserve = this.energyCapacityAvailable >= 650;

  let remoteNameToConstruct = undefined;

  let constructionComplete = true;
  outer: for (const info of activeRemotes) {
    const targetRoomName = info.remoteName;

    const memory = getRoomMemory(targetRoomName);

    const status = this.getRemoteStatus(targetRoomName);

    if (!status) {
      continue;
    }

    info.block = status.block;
    if (status.block) {
      Game.map.visual.text(`⛔`, new RoomPosition(49, 5, targetRoomName), {
        fontSize: 5,
        align: 'right',
      });
      continue;
    }

    const intermediates = status.intermediates;

    if (intermediates) {
      for (const intermediateName of intermediates) {
        const intermediateStatus = this.getRemoteStatus(intermediateName);
        if (intermediateStatus.block) {
          Game.map.visual.text(`⛔`, new RoomPosition(49, 5, targetRoomName), {
            fontSize: 5,
            align: 'right',
          });
          continue outer;
        }
      }
    }

    if (!status.constructionComplete) {
      constructionComplete = false;
    }

    const targetRoom = Game.rooms[targetRoomName];

    if (targetRoom) {
      const invaders = [...targetRoom.findHostileCreeps()].filter((creep) => creep.owner.username !== 'Source Keeper');
      const enemyInfo = getCombatInfo(invaders);
      const isEnemy = invaders.some((creep) => creep.checkBodyParts(INVADER_BODY_PARTS));
      const invaderCore = targetRoom
        .find(FIND_HOSTILE_STRUCTURES)
        .find((structure) => structure.structureType === STRUCTURE_INVADER_CORE);

      if (!memory.invader && isEnemy) {
        if (enemyInfo.strength <= invaderStrengthThreshold) {
          const request = new GuardRequest(this, targetRoomName, enemyInfo);
          Overlord.registerTask(request);
        }
        memory.invader = true;
      } else if (memory.invader && !isEnemy) {
        memory.invader = false;
      }

      if (!memory.isCombatant && enemyInfo.strength > 0) {
        const maxTicksToLive = Math.max(...invaders.map((creep) => creep.ticksToLive));
        memory.combatantsTicksToLive = Game.time + maxTicksToLive;
        memory.isCombatant = true;
      } else if (memory.isCombatant && enemyInfo.strength === 0) {
        memory.isCombatant = false;
        delete memory.combatantsTicksToLive;
      }

      if (!memory.invaderCore && invaderCore) {
        memory.invaderCore = true;
      } else if (memory.invaderCore && !invaderCore) {
        memory.invaderCore = false;
      }
    }

    if (memory.isCombatant) {
      const leftTicks = memory.combatantsTicksToLive - Game.time;
      Game.map.visual.text(`👿${leftTicks}`, new RoomPosition(49, 5, targetRoomName), {
        fontSize: 5,
        align: 'right',
      });
      if (leftTicks <= 0) {
        delete memory.isCombatant;
        delete memory.invader;
        delete memory.combatantsTicksToLive;
      }
      continue;
    }

    remotesToSpawn.push(info);

    if (
      canReserve &&
      !remoteNameToConstruct &&
      (!status.constructionComplete || Game.time > status.constructionCompleteTime + 3000)
    ) {
      remoteNameToConstruct = targetRoomName;
    }
  }

  this.constructRemote(remoteNameToConstruct, constructionComplete);
  this.spawnRemoteWorkers(remotesToSpawn, constructionComplete);
  this.manageRemoteHaulers();
};

Room.prototype.manageRemoteHaulers = function () {
  this.heap.numIdlingRemoteHaulerCarryParts = 0;

  const remoteInfos = this.memory.remotes;
  const activeRemoteNames = this.getActiveRemoteNames();

  if (!remoteInfos) {
    return;
  }

  const sourceStats = {};

  for (const remoteName in remoteInfos) {
    if (this.heap.remoteNameToConstruct && this.heap.remoteNameToConstruct === remoteName) {
      continue;
    }

    const memory = getRoomMemory(remoteName);

    if (memory.isCombatant) {
      continue;
    }

    const info = remoteInfos[remoteName];
    const sourceStat = info.sourceStat;
    const intermediates = info.intermediates;
    if (!sourceStat) {
      continue;
    }
    for (const sourceId in sourceStat) {
      const source = Game.getObjectById(sourceId);
      if (!source || !(source instanceof Source)) {
        continue;
      }
      const stat = sourceStat[sourceId];
      sourceStats[sourceId] = {
        sourceId: sourceId,
        roomName: remoteName,
        energyAmountNear: source.energyAmountNear,
        energy: source.energy,
        regeneration: source.ticksToRegeneration || 300,
        pathLength: stat.pathLength,
        work: activeRemoteNames.includes(remoteName) ? stat.work : 0,
        intermediates,
      };
    }
  }

  const haulers = Overlord.getCreepsByRole(this.name, 'remoteHauler').filter((creep) => {
    if (creep.spawning) {
      return false;
    }
    if (creep.memory.getRecycled) {
      return false;
    }
    return true;
  });

  const freeHaulers = [];

  for (const hauler of haulers) {
    if (hauler.memory.targetRoomName) {
      runRemoteHauler(hauler);
      if (!hauler.memory.supplying && hauler.memory.sourceId && sourceStats[hauler.memory.sourceId]) {
        sourceStats[hauler.memory.sourceId].energyAmountNear -= hauler.store.getCapacity();
      }
    }
    if (!hauler.memory.targetRoomName) {
      freeHaulers.push(hauler);
    }
  }

  if (!freeHaulers.length === 0) {
    return;
  }

  for (const hauler of freeHaulers) {
    let targetSourceId = undefined;
    let targetRoomName = undefined;
    let score = 0;

    const capacity = hauler.store.getCapacity();

    source: for (const sourceId in sourceStats) {
      const memory = getRoomMemory(targetRoomName);
      if (memory.isCombatant) {
        continue;
      }

      const stat = sourceStats[sourceId];
      if (stat.intermediates) {
        for (const intermediate of stat.intermediates) {
          if (getRoomMemory(intermediate).isCombatant) {
            continue source;
          }
        }
      }

      if (hauler.ticksToLive < 2.1 * stat.pathLength) {
        continue;
      }

      const expectedEnergyDelta = getSourceExpectedEnergyDelta(stat);
      const expectedEnergy = stat.energyAmountNear + expectedEnergyDelta;

      if (expectedEnergy < capacity) {
        continue;
      }

      const currentScore = expectedEnergy / stat.pathLength;

      if (currentScore > score) {
        targetSourceId = sourceId;
        targetRoomName = stat.roomName;
        targetPathLength = stat.pathLength;
        score = currentScore;
        continue;
      }
    }

    if (score > 0) {
      hauler.memory.targetRoomName = targetRoomName;

      hauler.memory.sourceId = targetSourceId;

      hauler.memory.pathLength = targetPathLength;

      sourceStats[targetSourceId].energyAmountNear -= capacity;

      runRemoteHauler(hauler);
    } else {
      hauler.say('😴', true);

      this.heap.numIdlingRemoteHaulerCarryParts += hauler.getActiveBodyparts(CARRY);

      Game.map.visual.text(`😴`, hauler.pos, { fontSize: 5 });

      if (hauler.ticksToLive < hauler.body.length * CREEP_SPAWN_TIME) {
        hauler.memory.getRecycled = true;
      }
    }
  }
};

function getSourceExpectedEnergyDelta(stat) {
  if (stat.pathLength < stat.regeneration) {
    return Math.min(stat.energy, HARVEST_POWER * stat.work * stat.pathLength);
  }

  return (
    Math.min(stat.energy, HARVEST_POWER * stat.work * stat.regeneration) +
    HARVEST_POWER * stat.work * (stat.pathLength - stat.regeneration)
  );
}

function runRemoteHauler(creep) {
  const base = Game.rooms[creep.memory.base];

  if (!base) {
    return;
  }

  base.heap.numRemoteHaulerCarryParts += creep.getActiveBodyparts(CARRY);

  if (creep.spawning) {
    return;
  }

  const targetRoomName = creep.memory.targetRoomName;

  if (!creep.readyToWork(targetRoomName)) {
    return;
  }

  if (creep.memory.supplying && creep.store.getUsedCapacity() === 0) {
    // 논리회로
    creep.memory.supplying = false;

    delete creep.heap.idling;
    delete creep.memory.targetRoomName;
    delete creep.memory.sourceId;
  } else if (!creep.memory.supplying && creep.store.getFreeCapacity() === 0) {
    creep.memory.supplying = true;

    const amount = creep.store.getUsedCapacity(RESOURCE_ENERGY);

    base.addRemoteProfit(targetRoomName, amount);
  }

  // 행동
  const path = base.getRemotePath(targetRoomName, creep.memory.sourceId);

  if (creep.memory.supplying) {
    if (creep.room.name === creep.memory.base) {
      return;
    }

    if (!path) {
      console.log(`No Path! room:${creep.memory.base}, remote:${targetRoomName}, source: ${creep.memory.sourceId} `);
      return;
    }

    creep.moveByRemotePath(path);
    return;
  }

  if (!creep.memory.targetRoomName) {
    return;
  }

  if (creep.ticksToLive < (creep.memory.pathLength || 0)) {
    creep.memory.getRecycled = true;
    const amount = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    base.addRemoteProfit(targetRoomName, amount);
    return;
  }

  creep.getResourceFromRemote(targetRoomName, creep.memory.sourceId, path);

  if (!creep.idling) {
    return;
  }

  creep.heap.idling = creep.heap.idling || 0;
  creep.heap.idling++;

  base.heap.numIdlingRemoteHaulerCarryParts += creep.getActiveBodyparts(CARRY);

  if (creep.heap.idling > 10) {
    console.log(`${creep.name} too much idling at ${creep.room.name}`);

    if (creep.store.getUsedCapacity() > 0) {
      const amount = creep.store.getUsedCapacity(RESOURCE_ENERGY);
      base.addRemoteProfit(targetRoomName, amount);
      creep.memory.supplying = true;
      console.log('return to base');
    } else {
      console.log('find another target');
      delete creep.memory.targetRoomName;
      delete creep.memory.sourceId;
    }
  }
}

Room.prototype.requestRemoteHauler = function (options = {}) {
  if (!this.hasAvailableSpawn()) {
    return;
  }

  const body = [];
  let cost = 0;

  const name = `${this.name} remoteHauler ${Game.time}_${this.spawnQueue.length}`;
  const memory = {
    role: 'remoteHauler',
    base: this.name,
  };

  if (options.noRoad) {
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
  spawnOptions.priority = SPAWN_PRIORITY['remoteHauler'];
  spawnOptions.cost = cost;

  const request = new RequestSpawn(body, name, memory, spawnOptions);
  this.spawnQueue.push(request);
};

Room.prototype.constructRemote = function (targetRoomName, constructionComplete) {
  const activeRemotes = this.getActiveRemotes();

  if (!targetRoomName && constructionComplete) {
    delete this.heap.remoteNameToConstruct;

    if (Math.random() < 0.005) {
      const roadDecayInfo = this.getRemoteRoadDecayInfo();
      const score = roadDecayInfo.lostHits + roadDecayInfo.numLowHits * 10000;
      const criteria = REPAIR_POWER * CREEP_LIFE_TIME;
      if (!this.memory.repairRemote && score > criteria) {
        this.memory.repairRemote = true;
      } else if (this.memory.repairRemote && roadDecayInfo.numLowHits === 0) {
        this.memory.repairRemote = false;
      }
    }

    const remoteBuilders = Overlord.getCreepsByRole(this.name, 'remoteBuilder');

    if (this.memory.repairRemote) {
      if (remoteBuilders.length === 0) {
        this.requestRemoteBuilder();
      }
      for (const remoteBuilder of remoteBuilders) {
        runRemoteRepairer(remoteBuilder);
      }
      return;
    }

    for (const remoteBuilder of remoteBuilders) {
      if (remoteBuilder.room.name !== this.name || isEdgeCoord(remoteBuilder.pos.x, remoteBuilder.pos.y)) {
        remoteBuilder.moveToRoom(this.name);
      } else {
        if (this.controller.level === 8) {
          remoteBuilder.memory.role = 'wallMaker';
        } else {
          remoteBuilder.memory.role = 'laborer';
          remoteBuilder.memory.isBuilder = true;
        }
      }
    }

    return;
  }

  const targetRoom = Game.rooms[targetRoomName];
  if (!targetRoom) {
    return;
  }

  Game.map.visual.text('🏗️', new RoomPosition(45, 5, targetRoomName), { fontSize: 5 });

  const remoteStatus = this.getRemoteStatus(targetRoomName);

  const roomNameToConstruct = remoteStatus.roomNameToConstruct;
  this.heap.remoteNameToConstruct = roomNameToConstruct;

  const remoteInfoToConstruct = activeRemotes.find((info) => info.remoteName === roomNameToConstruct);

  const remoteInfo = activeRemotes.find((info) => info.remoteName === targetRoomName);
  // value, spawntime, sourceIds

  const resourceIds = remoteInfo.resourceIds;

  if (remoteInfoToConstruct) {
    const constructBlueprints = this.getRemoteBlueprints(roomNameToConstruct);

    const resourceIdsToConstruct = [...remoteInfoToConstruct.resourceIds].filter(
      (id) => !constructBlueprints[id].isMineral
    );

    const remoteBuilders = Overlord.getCreepsByRole(this.name, 'remoteBuilder').filter((creep) => {
      if (creep.spawning) {
        return true;
      }
      return creep.ticksToLive > creep.body.length * CREEP_SPAWN_TIME;
    });

    let remoteBuilderNumWork = 0;

    for (let i = 0; i < remoteBuilders.length; i++) {
      const remoteBuilder = remoteBuilders[i];

      const resourceIdToConstruct = resourceIdsToConstruct[i % resourceIdsToConstruct.length];

      remoteBuilder.memory.targetRoomName = roomNameToConstruct;

      remoteBuilder.memory.sourceId = resourceIdToConstruct;

      runRemoteBuilder(remoteBuilder);

      remoteBuilderNumWork += remoteBuilder.getActiveBodyparts(WORK);
    }

    if (
      remoteBuilderNumWork < 6 * resourceIdsToConstruct.length ||
      remoteBuilders.length % resourceIdsToConstruct.length !== 0
    ) {
      this.requestRemoteBuilder();
    }
  }

  if (Math.random() < 0.9) {
    return;
  }

  remoteStatus.constructionComplete = remoteStatus.constructionComplete || false;

  const blueprints = this.getRemoteBlueprints(targetRoomName);

  let complete = true;

  remoteStatus.roomNameToConstruct = undefined;

  for (const resourceId of resourceIds) {
    const info = blueprints[resourceId];
    if (info.isMineral) {
      continue;
    }
    const packedStructures = info.structures;
    let numConstructionSites = 0;
    let currentRoomName = undefined;
    for (const packedStructure of packedStructures) {
      const parsed = unpackInfraPos(packedStructure);
      const pos = parsed.pos;

      if (currentRoomName !== pos.roomName) {
        currentRoomName = pos.roomName;
        numConstructionSites = 0;
      }

      if (numConstructionSites >= 5) {
        complete = false;
        continue;
      }

      if (!Game.rooms[pos.roomName]) {
        complete = false;
        continue;
      }

      if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0) {
        if (!remoteStatus.roomNameToConstruct && pos.roomName !== this.name) {
          remoteStatus.roomNameToConstruct = pos.roomName;
        }
        if (pos.roomName !== this.name) {
          complete = false;
        }
        numConstructionSites++;
        continue;
      }
      const structureType = parsed.structureType;

      if ([ERR_FULL, OK].includes(pos.createConstructionSite(structureType))) {
        complete = false;
        numConstructionSites++;
        continue;
      }
    }
  }

  if (complete) {
    delete remoteStatus.roomNameToConstruct;
    remoteStatus.constructionComplete = complete;
    remoteStatus.constructionCompleteTime = Game.time;
  }
};

Room.prototype.getRemoteRoadDecayInfo = function () {
  if (this._remoteRoadDecayInfo) {
    return this._remoteRoadDecayInfo;
  }

  const activeRemotes = this.getActiveRemotes();

  let lostHits = 0;
  let numLowHits = 0;
  let repairTargetRoomName = undefined;
  let repairTargetSourceId = undefined;
  let repairTargetNumLowHits = 0;
  let repairTargetLostHitsTotal = 0;

  for (const info of activeRemotes) {
    const remoteName = info.remoteName;

    if (!Game.rooms[remoteName]) {
      continue;
    }

    const resourceIds = info.resourceIds;

    const blueprint = this.getRemoteBlueprints(remoteName);

    for (const resourceId of resourceIds) {
      let routeLostHitsTotal = 0;
      let routeNumLowHits = 0;
      const sourceBlueprint = blueprint[resourceId];

      if (sourceBlueprint.isMineral) {
        continue;
      }

      const structures = sourceBlueprint.structures;

      for (const packed of structures) {
        const unpacked = unpackInfraPos(packed);

        const pos = unpacked.pos;

        if (pos.roomName === this.name) {
          break;
        }

        if (!Game.rooms[pos.roomName]) {
          continue;
        }

        const road = pos.lookFor(LOOK_STRUCTURES).find((structure) => structure.structureType === STRUCTURE_ROAD);

        if (road) {
          routeLostHitsTotal += road.hitsMax - road.hits;
          lostHits += road.hitsMax - road.hits;
          if (road.hits / road.hitsMax < 0.5) {
            routeNumLowHits++;
            numLowHits++;
          }
        }
      }

      if (routeNumLowHits < repairTargetNumLowHits) {
        continue;
      }

      if (routeNumLowHits > repairTargetNumLowHits || routeLostHitsTotal > repairTargetLostHitsTotal) {
        repairTargetRoomName = remoteName;
        repairTargetSourceId = resourceId;
        repairTargetNumLowHits = routeNumLowHits;
        repairTargetLostHitsTotal = routeLostHitsTotal;
      }
    }
  }

  return (this._remoteRoadDecayInfo = {
    lostHits,
    numLowHits,
    repairTargetRoomName,
    repairTargetSourceId,
  });
};

function runRemoteRepairer(creep) {
  const base = Game.rooms[creep.memory.base];

  if (!base) {
    return;
  }

  if (creep.spawning) {
    return;
  }

  if (!creep.memory.targetRoomName || !creep.memory.sourceId) {
    const remoteRoadDecayInfo = base.getRemoteRoadDecayInfo();
    const targetRoomName = remoteRoadDecayInfo.repairTargetRoomName;
    const sourceId = remoteRoadDecayInfo.repairTargetSourceId;
    if (!targetRoomName || !sourceId) {
      return;
    }
    creep.memory.targetRoomName = targetRoomName;
    creep.memory.sourceId = sourceId;
  }

  const targetRoomName = creep.memory.targetRoomName;

  Game.map.visual.text('🔧', new RoomPosition(45, 5, targetRoomName), { fontSize: 5 });

  if (!creep.readyToWork(targetRoomName)) {
    return;
  }

  // 논리회로
  if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
    creep.memory.working = false;
  } else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
    const source = Game.getObjectById(creep.memory.sourceId);
    if (source && source.pos.getRangeTo(creep) <= 3) {
      creep.memory.working = true;
      delete creep.heap.targetId;
    }
  }

  // 행동

  const path = base.getRemotePath(targetRoomName, creep.memory.sourceId);

  if (creep.memory.working) {
    if (creep.room.name === creep.memory.base) {
      delete creep.memory.targetRoomName;
      delete creep.memory.sourceId;
      creep.memory.working = false;
      return;
    }

    const closeBrokenThings = creep.pos
      .findInRange(FIND_STRUCTURES, 3)
      .filter((structure) => structure.structureType === STRUCTURE_ROAD && structure.hits < structure.hitsMax);
    if (closeBrokenThings.length) {
      creep.repair(closeBrokenThings[0]);
      return;
    }

    if (!path) {
      console.log(`No Path! room:${creep.memory.base}, remote:${targetRoomName}, source: ${creep.memory.sourceId} `);
      return;
    }

    creep.moveByRemotePath(path);

    return;
  }

  creep.getResourceFromRemote(targetRoomName, creep.memory.sourceId, path, { resourceType: RESOURCE_ENERGY });
}

function runRemoteBuilder(creep) {
  const base = Game.rooms[creep.memory.base];

  if (!base) {
    return;
  }

  if (creep.spawning) {
    return;
  }
  const targetRoomName = creep.memory.targetRoomName;

  if (!creep.readyToWork(targetRoomName, { wait: true })) {
    return;
  }

  // 논리회로
  if (creep.memory.working && creep.store.getUsedCapacity() === 0) {
    creep.memory.working = false;
  } else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
    creep.memory.working = true;
    delete creep.heap.targetId;
  }

  // 행동

  const path = base.getRemotePath(targetRoomName, creep.memory.sourceId);

  if (creep.memory.working) {
    if (creep.room.name !== targetRoomName) {
      creep.moveToRoom(targetRoomName);
      return;
    }

    const constructionSites = creep.room.constructionSites;

    if (constructionSites.length > 0 && creep.store.getUsedCapacity(RESOURCE_ENERGY)) {
      if (!creep.heap.targetId || !Game.getObjectById(creep.heap.targetId)) {
        creep.heap.targetId = creep.pos.findClosestByRange(constructionSites).id;
      }

      const target = Game.getObjectById(creep.heap.targetId);

      if (!target) {
        return;
      }

      if (creep.pos.getRangeTo(target) > 3 || isEdgeCoord(creep.pos.x, creep.pos.y)) {
        creep.moveMy({ pos: target.pos, range: 1 });
        return;
      }

      creep.setWorkingInfo(target.pos, 3);
      creep.build(target);
    }

    return;
  }

  creep.getResourceFromRemote(targetRoomName, creep.memory.sourceId, path, { resourceType: RESOURCE_ENERGY });
}

Room.prototype.requestRemoteBuilder = function () {
  const maxWork = 6;

  if (!this.hasAvailableSpawn()) {
    return;
  }

  const model = getBuilderModel(this.energyCapacityAvailable, maxWork);

  const body = model.body;

  const name = `${this.name} remoteBuilder ${Game.time}_${this.spawnQueue.length}`;

  const memory = {
    role: 'remoteBuilder',
    working: false,
    base: this.name,
  };

  let priority = SPAWN_PRIORITY['remoteBuilder'];

  const spawnOptions = { priority };

  const request = new RequestSpawn(body, name, memory, spawnOptions);
  this.spawnQueue.push(request);
};

Room.prototype.spawnRemoteWorkers = function (remotesToSpawn, constructionComplete) {
  const fontSize = 4;
  const opacity = 1;
  const black = '#000000';

  this.memory.currentRemoteIncome = 0;

  let requested = false;

  const needBigMiner = this.getNeedBigMiner();

  let numHauler = 0;
  let numCarry = 0;
  let maxCarry = 0;

  const ratio = this.storage ? 1 : 0.9;
  const energyCapacity = Math.max(this.energyCapacityAvailable * ratio, 300);

  const maxHaulerCarry = constructionComplete
    ? 2 * Math.min(Math.floor(energyCapacity / 150), 16) // with road
    : Math.min(Math.floor(energyCapacity / 100), 25); // without road

  const haulers = Overlord.getCreepsByRole(this.name, 'remoteHauler').filter((creep) => {
    if (creep.spawning) {
      return true;
    }
    if (creep.memory.getRecycled) {
      return false;
    }
    return creep.ticksToLive > creep.body.length * CREEP_SPAWN_TIME;
  });

  for (const hauler of haulers) {
    numCarry += hauler.getActiveBodyparts(CARRY);
    numHauler++;
  }

  for (const info of remotesToSpawn) {
    const targetRoomName = info.remoteName;

    const status = this.getRemoteStatus(targetRoomName);

    const roomType = status.roomType;

    if (roomType === 'normal') {
      const result = this.spawnNormalRemoteWorkers(info, {
        requested,
        numCarry,
        maxCarry,
        needBigMiner,
        maxHaulerCarry,
        constructionComplete,
      });
      requested = result.requested;
      maxCarry = result.maxCarry;
    } else if (roomType === 'sourceKeeper') {
      const result = this.spawnSourceKeeperRemoteWorkers(info, {
        requested,
        numCarry,
        maxCarry,
        maxHaulerCarry,
        constructionComplete,
      });
      requested = result.requested;
      maxCarry = result.maxCarry;
    }
  }

  maxCarry = Math.ceil(maxCarry);

  Game.map.visual.text(`🚚${numCarry}/${maxCarry} `, new RoomPosition(25, 35, this.name), {
    fontSize,
    backgroundColor: numCarry >= maxCarry ? black : COLOR_NEON_RED,
    opacity,
  });

  if (this.heap.numIdlingRemoteHaulerCarryParts > 0) {
    const idlingPercentage = Math.floor((this.heap.numIdlingRemoteHaulerCarryParts / numCarry) * 10000) / 100;
    Game.map.visual.text(`😴${idlingPercentage}%`, new RoomPosition(25, 40, this.name), {
      fontSize,
      backgroundColor: COLOR_NEON_RED,
      opacity: 1,
    });
  }
  Game.map.visual.text(`🚚${numCarry}/${maxCarry} `, new RoomPosition(25, 35, this.name), {
    fontSize,
    backgroundColor: numCarry >= maxCarry ? black : COLOR_NEON_RED,
    opacity,
  });
};

Room.prototype.getNeedBigMiner = function () {
  if (this._needBigMiner) {
    return this._needBigMiner;
  }

  const avgCpu = Overlord.getAverageCpu();

  return (this._needBigMiner = this.controller.level >= 6 && (avgCpu / Game.cpu.limit > 0.8 || Game.cpu.bucket < 9000));
};

Room.prototype.spawnSourceKeeperRemoteWorkers = function (info, options) {
  // options = { requested, numCarry, maxCarry, needBigMiner, maxHaulerCarry,constructionComplete }
  const targetRoomName = info.remoteName;

  const blueprints = this.getRemoteBlueprints(targetRoomName);

  const { requested, numCarry, maxCarry, maxHaulerCarry, constructionComplete } = options;

  const result = { requested, maxCarry };

  if (!blueprints) {
    return result;
  }

  const status = this.getRemoteStatus(targetRoomName);

  const resourceIds = info.resourceIds;

  const sourceStat = {};

  for (const resourceId of resourceIds) {
    const blueprint = blueprints[resourceId];

    const isMineral = blueprint.isMineral;

    if (isMineral) {
      continue;
    }

    const maxWork = 12;

    const sourceMaxCarry = blueprint.maxCarry;

    sourceStat[resourceId] = {
      numMiner: 0,
      work: 0,
      pathLength: blueprint.pathLength,
      maxWork,
      maxCarry: sourceMaxCarry,
    };

    if (this.heap.remoteNameToConstruct && this.heap.remoteNameToConstruct === targetRoomName) {
      continue;
    }
    result.maxCarry += sourceMaxCarry;
    // If you cannot reserve, 2.5 e/tick + no container, so it decays 1e/tick. So it becomes 1.5e / tick. which is 0.3 of 5e/tick
  }

  const targetRoom = Game.rooms[targetRoomName];

  const miners = Overlord.getCreepsByRole(targetRoomName, 'remoteMiner').filter((creep) => {
    if (creep.spawning) {
      return true;
    }
    const stat = sourceStat[creep.memory.sourceId];
    if (!stat) {
      return false;
    }
    const pathLength = sourceStat[creep.memory.sourceId].pathLength;
    return creep.ticksToLive > creep.body.length * CREEP_SPAWN_TIME + pathLength;
  });

  for (const miner of miners) {
    const sourceId = miner.memory.sourceId;
    if (!sourceStat[sourceId]) {
      continue;
    }
    sourceStat[sourceId].work += miner.getActiveBodyparts(WORK);
    sourceStat[sourceId].numMiner++;
  }

  status.sourceStat = sourceStat;

  const positions = [
    { x: 10, y: 15 },
    { x: 40, y: 15 },
    { x: 10, y: 30 },
    { x: 40, y: 30 },
  ];
  let i = 0;
  for (const sourceId of Object.keys(sourceStat)) {
    const x = positions[i].x;
    const y = positions[i].y;
    i++;
    const stat = sourceStat[sourceId];
    if (stat.notMining) {
      continue;
    }
    const fontSize = 4;
    const opacity = 1;
    const black = '#000000';
    Game.map.visual.text(`⛏️${stat.work}/${stat.maxWork}`, new RoomPosition(x, y, targetRoomName), {
      fontSize,
      backgroundColor: stat.work >= stat.maxWork ? black : COLOR_NEON_RED,
      opacity,
    });
    const source = Game.getObjectById(sourceId);
    if (source && source instanceof Source) {
      const amountNear = source.energyAmountNear;
      Game.map.visual.text(`🔋${amountNear}/2000 `, new RoomPosition(x, y + 5, targetRoomName), {
        fontSize,
        backgroundColor: amountNear < 2000 ? black : COLOR_NEON_RED,
        opacity,
      });
    }
  }

  if (result.requested) {
    return result;
  }

  const sourceKeeperHandlers = Overlord.getCreepsByRole(targetRoomName, 'sourceKeeperHandler');
  if (!sourceKeeperHandlers.find((creep) => creep.ticksToLive > 200 || creep.spawning)) {
    const resourceIds = status.resourceIdsToHandle;

    this.requestSourceKeeperHandler(targetRoomName, resourceIds);
    result.requested = true;
    return result;
  }

  for (const resourceId of resourceIds) {
    const sourceBlueprint = blueprints[resourceId];

    const isMineral = sourceBlueprint.isMineral;

    if (isMineral) {
      continue;
    }

    const stat = sourceStat[resourceId];
    const maxWork = stat.maxWork;
    if (stat.work < maxWork && stat.numMiner < sourceBlueprint.available) {
      let containerId = undefined;
      if (Game.getObjectById(sourceBlueprint.containerId)) {
        containerId = sourceBlueprint.containerId;
      } else if (targetRoom) {
        const containerPacked = sourceBlueprint.structures.find((packed) => {
          const parsed = unpackInfraPos(packed);
          return parsed.structureType === 'container';
        });
        const containerUnpacked = unpackInfraPos(containerPacked);
        const container = containerUnpacked.pos
          .lookFor(LOOK_STRUCTURES)
          .find((structure) => structure.structureType === 'container');
        if (container) {
          containerId = sourceBlueprint.containerId = container.id;
        }
      }
      this.requestRemoteMiner(targetRoomName, resourceId, {
        containerId,
        maxWork,
      });
      result.requested = true;
      return result;
    }

    if (numCarry < result.maxCarry) {
      this.requestRemoteHauler({
        maxCarry: maxHaulerCarry,
        noRoad: !constructionComplete,
      });
      result.requested = true;
      return result;
    }
  }
  return result;
};

Room.prototype.requestSourceKeeperHandler = function (targetRoomName, resourceIds) {
  if (!this.hasAvailableSpawn()) {
    return;
  }

  const body = sourceKeeperHandlerBody;
  const cost = 4270;

  const name = `${targetRoomName} sourceKeeperHandler ${Game.time}_${this.spawnQueue.length}`;

  const memory = {
    role: 'sourceKeeperHandler',
    base: this.name,
    targetRoomName: targetRoomName,
    resourceIds,
  };

  const request = new RequestSpawn(body, name, memory, {
    priority: SPAWN_PRIORITY['sourceKeeperHandler'],
    cost: cost,
  });
  this.spawnQueue.push(request);
};

Room.prototype.spawnNormalRemoteWorkers = function (info, options) {
  // options = { requested, numCarry, maxCarry, needBigMiner, maxHaulerCarry,constructionComplete }
  const targetRoomName = info.remoteName;

  const blueprints = this.getRemoteBlueprints(targetRoomName);

  const { requested, numCarry, maxCarry, needBigMiner, maxHaulerCarry, constructionComplete } = options;

  const result = { requested, maxCarry };

  if (!blueprints) {
    return result;
  }

  const canReserve = this.energyCapacityAvailable >= 650;

  const reservationTick = getReservationTick(targetRoomName);
  Game.map.visual.text(`⏰${reservationTick}`, new RoomPosition(49, 45, targetRoomName), {
    fontSize: 5,
    align: 'right',
  });

  const status = this.getRemoteStatus(targetRoomName);

  const resourceIds = info.resourceIds;

  const maxWork = canReserve ? 5 : 3;

  const sourceStat = {};

  for (const resourceId of resourceIds) {
    const blueprint = blueprints[resourceId];
    const sourceMaxCarry = blueprint.maxCarry * (canReserve ? 1 : 0.3);
    sourceStat[resourceId] = {
      numMiner: 0,
      work: 0,
      pathLength: blueprint.pathLength,
      maxWork,
      maxCarry: sourceMaxCarry,
    };

    if (this.heap.remoteNameToConstruct && this.heap.remoteNameToConstruct === targetRoomName) {
      const source = Game.getObjectById(resourceId);
      if (source && source.energyAmountNear < 500) {
        continue;
      }
    }
    result.maxCarry += sourceMaxCarry;
    // If you cannot reserve, 2.5 e/tick + no container, so it decays 1e/tick. So it becomes 1.5e / tick. which is 0.3 of 5e/tick
  }

  const targetRoom = Game.rooms[targetRoomName];

  const miners = Overlord.getCreepsByRole(targetRoomName, 'remoteMiner').filter((creep) => {
    if (creep.spawning) {
      return true;
    }
    const stat = sourceStat[creep.memory.sourceId];
    if (!stat) {
      return false;
    }
    const pathLength = sourceStat[creep.memory.sourceId].pathLength;
    return creep.ticksToLive > creep.body.length * CREEP_SPAWN_TIME + pathLength;
  });

  for (const miner of miners) {
    const sourceId = miner.memory.sourceId;
    sourceStat[sourceId].work += miner.getActiveBodyparts(WORK);
    sourceStat[sourceId].numMiner++;
  }

  status.sourceStat = sourceStat;

  if (!this.heap.remoteNameToConstruct || this.heap.remoteNameToConstruct !== targetRoomName) {
    let income = 0;
    const value = this.getRemoteValue(targetRoomName);
    for (const resourceId of resourceIds) {
      const deficiency = result.maxCarry - numCarry;
      const minerRatio = sourceStat[resourceId].work / maxWork;
      const haulerRatio = Math.clamp(
        (sourceStat[resourceId].maxCarry - deficiency) / sourceStat[resourceId].maxCarry,
        0,
        1
      );
      income += value.resources[resourceId] * Math.min(minerRatio, haulerRatio);
    }
    income -= value.reserve || 0;
    this.memory.currentRemoteIncome += income;
  }

  let x = 10;
  const fontSize = 4;
  const opacity = 1;
  const black = '#000000';

  for (const resourceId of resourceIds) {
    const stat = sourceStat[resourceId];
    Game.map.visual.text(`⛏️${stat.work}/${maxWork}`, new RoomPosition(x, 20, targetRoomName), {
      fontSize,
      backgroundColor: stat.work >= maxWork ? black : COLOR_NEON_RED,
      opacity,
    });
    const source = Game.getObjectById(resourceId);
    if (source) {
      const amountNear = source.energyAmountNear;
      Game.map.visual.text(`🔋${amountNear}/2000 `, new RoomPosition(x, 25, targetRoomName), {
        fontSize,
        backgroundColor: amountNear < 2000 ? black : COLOR_NEON_RED,
        opacity,
      });
    }
    x += 30;
  }

  if (result.requested) {
    return result;
  }

  const memory = getRoomMemory(targetRoomName);
  if (memory.invaderCore) {
    const coreAttackers = Overlord.getCreepsByRole(targetRoomName, 'coreAttacker');
    if (coreAttackers.length === 0) {
      this.requestCoreAttacker(targetRoomName);
      result.requested = true;
      return result;
    }
  }

  if (canReserve && reservationTick < RESERVATION_TICK_THRESHOLD) {
    const reservers = Overlord.getCreepsByRole(targetRoomName, 'reserver');
    const numClaimParts = reservers.map((creep) => creep.getActiveBodyparts('claim')).reduce((a, b) => a + b, 0);

    if (numClaimParts < 2 && reservers.length < (status.controllerAvailable || 2)) {
      this.requestReserver(targetRoomName);
      result.requested = true;
      return result;
    }
  }

  if (reservationTick < 0) {
    return result;
  }

  for (const resourceId of resourceIds) {
    const sourceBlueprint = blueprints[resourceId];
    const stat = sourceStat[resourceId];

    if (stat.work < maxWork && stat.numMiner < sourceBlueprint.available) {
      let containerId = undefined;
      if (Game.getObjectById(sourceBlueprint.containerId)) {
        containerId = sourceBlueprint.containerId;
      } else if (targetRoom) {
        const containerPacked = sourceBlueprint.structures.find((packed) => {
          const parsed = unpackInfraPos(packed);
          return parsed.structureType === 'container';
        });
        const containerUnpacked = unpackInfraPos(containerPacked);
        const container = containerUnpacked.pos
          .lookFor(LOOK_STRUCTURES)
          .find((structure) => structure.structureType === 'container');
        if (container) {
          containerId = sourceBlueprint.containerId = container.id;
        }
      }
      const numWork = maxWork === 5 ? (needBigMiner ? 12 : 6) : maxWork;
      this.requestRemoteMiner(targetRoomName, resourceId, {
        containerId,
        maxWork: numWork,
      });
      result.requested = true;
      return result;
    }

    if (numCarry < result.maxCarry) {
      this.requestRemoteHauler({
        maxCarry: maxHaulerCarry,
        noRoad: !constructionComplete,
      });
      result.requested = true;
      return result;
    }
  }
  return result;
};

Room.prototype.requestCoreAttacker = function (targetRoomName) {
  if (!this.hasAvailableSpawn()) {
    return;
  }

  let body = [];
  let cost = 0;
  const bodyLength = Math.min(Math.floor(this.energyCapacityAvailable / 130), 25);
  for (let i = 0; i < bodyLength; i++) {
    body.push(ATTACK);
    cost += 80;
  }
  for (let i = 0; i < bodyLength; i++) {
    body.push(MOVE);
    cost += 50;
  }

  const name = `${targetRoomName} coreAttacker ${Game.time}_${this.spawnQueue.length}`;
  const memory = {
    role: 'coreAttacker',
    base: this.name,
    targetRoomName,
  };
  const request = new RequestSpawn(body, name, memory, { priority: SPAWN_PRIORITY['coreAttacker'], cost: cost });
  this.spawnQueue.push(request);
};

Room.prototype.requestRemoteMiner = function (targetRoomName, sourceId, options = {}) {
  if (!this.hasAvailableSpawn()) {
    return;
  }

  const maxWork = options.maxWork || 6;

  const model = getRemoteMinerModel(this.energyCapacityAvailable, maxWork);

  const body = model.body;

  const cost = model.cost;

  const name = `${targetRoomName} remoteMiner ${Game.time}_${this.spawnQueue.length}`;
  const memory = {
    role: 'remoteMiner',
    base: this.name,
    targetRoomName,
    sourceId,
  };

  const spawnOptions = {};
  spawnOptions.priority = SPAWN_PRIORITY['remoteMiner'];
  spawnOptions.cost = cost;

  if (options.containerId) {
    memory.containerId = options.containerId;
  }

  const request = new RequestSpawn(body, name, memory, spawnOptions);
  this.spawnQueue.push(request);
};

function getRemoteMinerModel(energyCapacity, maxWork) {
  let cost = 0;
  let work = 0;
  let move = 0;
  let carry = 0;
  while (cost < energyCapacity && work + move + carry < MAX_CREEP_SIZE) {
    if ((move === 0 || work / move >= 2) && energyCapacity >= cost + BODYPART_COST[MOVE]) {
      move++;
      cost += BODYPART_COST[MOVE];
      continue;
    }

    if (work >= 5 && carry < 1 && energyCapacity >= cost + BODYPART_COST[CARRY]) {
      carry++;
      cost += BODYPART_COST[CARRY];
      continue;
    }

    if (maxWork && work >= maxWork) {
      break;
    }

    if (energyCapacity >= cost + BODYPART_COST[WORK]) {
      work++;
      cost += BODYPART_COST[WORK];
      continue;
    }
    break;
  }

  const body = parseBody(`${work - 1}w${carry}c${move}m1w`);

  return { body, numWork: work, cost };
}

function getReservationTick(targetRoomName) {
  const targetRoom = Game.rooms[targetRoomName];
  if (!targetRoom) {
    return 0;
  }

  if (!targetRoom.controller) {
    return 0;
  }

  if (!targetRoom.controller.reservation) {
    return 0;
  }

  const reservation = targetRoom.controller.reservation;

  const sign = reservation.username === MY_NAME ? 1 : -1;

  return reservation.ticksToEnd * sign;
}

function getInvaderStrengthThreshold(level) {
  return Math.exp((level - 1) * 0.4) * 100;
}

// get remote net income per tick with EMA
Room.prototype.getRemoteNetIncomePerTick = function (targetRoomName) {
  const remoteStatus = this.getRemoteStatus(targetRoomName);

  if (!remoteStatus.startTick) {
    delete remoteStatus.netIncome;
  }

  remoteStatus.startTick = remoteStatus.startTick || Game.time;
  remoteStatus.lastTick = remoteStatus.lastTick || Game.time;
  const netIncome = remoteStatus.netIncome || 0;

  const interval = Game.time - remoteStatus.lastTick;

  // 1 unit with alpha = 0.2
  // recent unit is weighted by 0.2
  // previous unit is wighted by 0.2 * 0.8
  const alpha = 0.2;

  if (interval >= CREEP_LIFE_TIME) {
    if (remoteStatus.netIncomePerTick) {
      const modifiedAlpha = 1 - Math.pow(1 - alpha, interval / CREEP_LIFE_TIME);
      remoteStatus.netIncomePerTick =
        modifiedAlpha * (netIncome / interval) + (1 - modifiedAlpha) * remoteStatus.netIncomePerTick;
    } else {
      remoteStatus.netIncomePerTick = netIncome / interval;
    }
    remoteStatus.lastTick = Game.time;
    remoteStatus.netIncome = 0;
  }

  if (!remoteStatus.netIncomePerTick) {
    return netIncome / interval;
  }

  return remoteStatus.netIncomePerTick;
};

Room.prototype.addRemoteCost = function (targetRoomName, amount) {
  const remoteStatus = this.getRemoteStatus(targetRoomName);
  if (remoteStatus) {
    remoteStatus.netIncome = remoteStatus.netIncome || 0;
    remoteStatus.netIncome -= amount;
    return;
  }
};

Room.prototype.addRemoteProfit = function (targetRoomName, amount) {
  const remoteStatus = this.getRemoteStatus(targetRoomName);
  if (remoteStatus) {
    remoteStatus.netIncome = remoteStatus.netIncome || 0;
    remoteStatus.netIncome += amount;
    return;
  }
};

Room.prototype.getActiveRemoteNames = function () {
  const activeRemotes = this.getActiveRemotes() || [];
  return activeRemotes.map((remoteInfo) => remoteInfo.remoteName);
};

Room.prototype.resetActiveRemotes = function () {
  delete this.memory.activeRemotes;
};

/**
 * get active remote infos
 * @returns array of objects which contains informations: remoteName, intermediate, value, weight, resourceIds, block
 */
Room.prototype.getActiveRemotes = function () {
  if (this._activeRemotes !== undefined) {
    return this._activeRemotes;
  }

  const numSpawn = this.structures.spawn.length;
  const canReserve = this.energyCapacityAvailable >= 650;
  const level = this.controller.level;

  if (this.memory.activeRemotes) {
    const before = this.memory.activeRemotes;
    if (
      before.numSpawn === numSpawn &&
      before.canReserve === canReserve &&
      before.level === level &&
      Game.time < before.time + CREEP_LIFE_TIME
    ) {
      return (this._activeRemotes = before.infos);
    }
  }

  const result = {
    infos: [],
    numSpawn,
    canReserve,
    level,
    time: Game.time,
  };

  const remoteInfos = [];

  for (const remoteName of this.getRemoteNames()) {
    const roomType = getRoomType(remoteName);
    if (roomType === 'sourceKeeper' && isStronghold(remoteName)) {
      continue;
    }

    const remoteStatus = this.getRemoteStatus(remoteName);
    if (!remoteStatus) {
      continue;
    }

    if (Memory.blockedRemotes && Memory.blockedRemotes.includes(remoteName)) {
      continue;
    }

    if (remoteStatus.roomType === 'sourceKeeper' && this.energyCapacityAvailable < 4270) {
      //energy to spawn SK handler
      continue;
    }

    // basic

    const value = this.getRemoteValue(remoteName);
    const spawnUsage = this.getRemoteSpawnUsage(remoteName);

    if (!value || !spawnUsage) {
      continue;
    }

    const intermediates = remoteStatus.intermediates;

    const info = {
      remoteName,
      intermediates,
      value: value.total,
      weight: spawnUsage.total,
      resourceIds: Object.keys(remoteStatus.blueprints),
    };

    remoteInfos.push(info);

    if (remoteStatus.numSource <= 1 || remoteStatus.roomType !== 'normal') {
      continue;
    }

    // oneSource
    const betterSourceId = remoteStatus.betterSourceId;
    const betterSourceValue = value.resources[betterSourceId] + (value.reserve || 0);
    const betterSourceWeight = spawnUsage.resources[betterSourceId] + (spawnUsage.reserve || 0);
    const info2 = {
      remoteName,
      intermediates,
      value: betterSourceValue,
      weight: betterSourceWeight,
      resourceIds: [betterSourceId],
    };

    remoteInfos.push(info2);
  }

  let spawnCapacityForRemotes = Math.floor(this.structures.spawn.length * 485 - this.getBasicSpawnCapacity());

  if (spawnCapacityForRemotes <= 0) {
    this.memory.activeRemotes = result;
    return (this._activeRemotes = result.infos);
  }

  // vaules
  const table = new Array(spawnCapacityForRemotes + 1).fill(0);

  // remoteNames
  const resultTable = new Array(spawnCapacityForRemotes + 1);
  for (let i = 0; i < resultTable.length; i++) {
    resultTable[i] = [];
  }

  // DP starts
  for (let i = 0; i < remoteInfos.length; i++) {
    const info = remoteInfos[i];
    const remoteName = remoteInfos[i].remoteName;
    const v = info.value;
    const w = Math.ceil(info.weight + (this.controller.level < 8 ? v * 1.4 : 0));
    // if controller level is under 8, should consider upgrader spawn usage
    const intermediateNames = info.intermediates;
    for (let j = spawnCapacityForRemotes; j > 0; j--) {
      if (j + w > spawnCapacityForRemotes || table[j] === 0) {
        continue;
      }

      const resultRemoteNames = resultTable[j].map((info) => info.remoteName);

      if (resultRemoteNames.includes(remoteName)) {
        continue;
      }

      if (
        intermediateNames &&
        intermediateNames.some((intermediateName) => !resultRemoteNames.includes(intermediateName))
      ) {
        continue;
      }

      if (table[j] + v > table[j + w]) {
        table[j + w] = table[j] + v;
        resultTable[j + w] = [...resultTable[j], info];
      }
    }

    if (intermediateNames && intermediateNames.length > 0) {
      continue;
    }

    if (v > table[w]) {
      table[w] = v;
      resultTable[w] = [...resultTable[0], info];
    }
  }

  // find best option
  let bestValue = 0;
  for (let i = 0; i < table.length; i++) {
    if (table[i] > bestValue) {
      bestValue = table[i];
      result.infos = resultTable[i];
    }
  }
  result.infos.sort((a, b) => b.value / b.weight - a.value / a.weight);

  this.memory.activeRemotes = result;

  return (this._activeRemotes = result.infos);
};

Room.prototype.addRemote = function (targetRoomName) {
  this.memory.remotes = this.memory.remotes || {};
  this.memory.remotes[targetRoomName] = {};

  this.getRemoteBlueprints(targetRoomName);

  this.resetActiveRemotes();
};

Room.prototype.deleteRemote = function (targetRoomName) {
  this.memory.remotes = this.memory.remotes || {};

  delete this.memory.remotes[targetRoomName];

  this.resetActiveRemotes();
};

Room.prototype.getRemoteValue = function (targetRoomName) {
  const roomType = getRoomType(targetRoomName);
  if (roomType === 'normal') {
    return this.getNormalRemoteValue(targetRoomName);
  } else if (roomType === 'sourceKeeper') {
    return this.getSourceKeeperRemoteValue(targetRoomName);
  }
};

Room.prototype.getSourceKeeperRemoteValue = function (targetRoomName) {
  const remoteStatus = this.getRemoteStatus(targetRoomName);

  if (remoteStatus && remoteStatus.remoteValue) {
    return remoteStatus.remoteValue;
  }

  const blueprints = this.getRemoteBlueprints(targetRoomName);

  const result = { total: 0, numSource: 0, resources: {} };

  if (!blueprints) {
    console.log(`${this.name} cannot get blueprint of ${targetRoomName}`);
    return result;
  }

  for (const blueprint of Object.values(blueprints)) {
    result.numSource++;

    if (blueprint.isMineral) {
      continue;
    }

    const income = (SOURCE_ENERGY_KEEPER_CAPACITY + 600) / ENERGY_REGEN_TIME; // 600 is from tombstone
    const distance = blueprint.pathLength;

    const minerCost = 1600 / (CREEP_LIFE_TIME - distance); // 12w7m1c
    const haluerCost = (blueprint.maxCarry * 75) / CREEP_LIFE_TIME;
    const creepCost = minerCost + haluerCost;

    const containerCost = 0.5;
    const totalCost = creepCost + containerCost;

    const netIncome = income - totalCost;

    result.resources[blueprint.resourceId] = netIncome;
    result.total += netIncome;
  }

  result.total -= 4270 / CREEP_LIFE_TIME; // SK handler

  if (remoteStatus) {
    remoteStatus.remoteValue = result;
  }

  return result;
};

Room.prototype.getNormalRemoteValue = function (targetRoomName) {
  const remoteStatus = this.getRemoteStatus(targetRoomName);
  const canReserve = this.energyCapacityAvailable >= 650;
  const needBigMiner = this.getNeedBigMiner();

  if (
    remoteStatus &&
    remoteStatus.remoteValue &&
    remoteStatus.remoteValue.canReserve === canReserve &&
    remoteStatus.remoteValue.needBigMiner === needBigMiner
  ) {
    return remoteStatus.remoteValue;
  }

  const blueprints = this.getRemoteBlueprints(targetRoomName);

  const result = { canReserve, total: 0, numSource: 0, resources: {} };

  if (!blueprints) {
    console.log(`${this.name} cannot get blueprint of ${targetRoomName}`);
    return result;
  }

  for (const blueprint of Object.values(blueprints)) {
    result.numSource++;

    const income = canReserve ? 10 : 5;
    const distance = blueprint.pathLength;

    const minerCost = (needBigMiner ? 1600 : 950) / (CREEP_LIFE_TIME - distance);
    const haluerCost = (blueprint.maxCarry * (canReserve ? 75 : 100)) / CREEP_LIFE_TIME;
    const creepCost = (minerCost + haluerCost) * (canReserve ? 1 : 0.5);

    const containerCost = canReserve ? 0.5 : 0;
    const totalCost = creepCost + containerCost;

    const netIncome = income - totalCost;

    result.resources[blueprint.resourceId] = netIncome;
    result.total += netIncome;
  }

  if (canReserve) {
    result.reserve = (-1 * (BODYPART_COST[CLAIM] + BODYPART_COST[MOVE])) / CREEP_CLAIM_LIFE_TIME;
    result.total += result.reserve;
  }

  result.canReserve = canReserve;
  result.needBigMiner = needBigMiner;

  if (remoteStatus) {
    remoteStatus.remoteValue = result;
  }

  return result;
};

Room.prototype.getRemoteSpawnUsage = function (targetRoomName) {
  const roomType = getRoomType(targetRoomName);
  if (roomType === 'normal') {
    return this.getNormalRemoteSpawnUsage(targetRoomName);
  } else if (roomType === 'sourceKeeper') {
    return this.getSourceKeeperRemoteSpawnUsage(targetRoomName);
  }
};

Room.prototype.getSourceKeeperRemoteSpawnUsage = function (targetRoomName) {
  if (isStronghold(targetRoomName)) {
    return 0;
  }

  const remoteStatus = this.getRemoteStatus(targetRoomName);

  if (remoteStatus && remoteStatus.spawnUsage && remoteStatus.spawnUsage.level === this.controller.level) {
    return remoteStatus.spawnUsage;
  }

  const blueprints = this.getRemoteBlueprints(targetRoomName);

  if (!blueprints) {
    return;
  }

  const result = { total: 0 };

  result.total += sourceKeeperHandlerBody.length;

  for (const blueprint of Object.values(blueprints)) {
    if (blueprint.isMineral) {
      continue;
    }
    result.total += 20; // miner
    result.total += blueprint.maxCarry * 1.5;
  }

  if (remoteStatus) {
    remoteStatus.spawnUsage = result;
    remoteStatus.spawnUsage.level = this.controller.level;
  }

  return result;
};

function isStronghold(targetRoomName) {
  Memory.rooms[targetRoomName] = Memory.rooms[targetRoomName] || {};
  const memory = Memory.rooms[targetRoomName];
  const invaderCoreInfo = memory.invaderCore;

  const targetRoom = Game.rooms[targetRoomName];

  if (!targetRoom) {
    if (invaderCoreInfo) {
      if (invaderCoreInfo.deployTime && Game.time < invaderCoreInfo.deployTime) {
        return false;
      }

      if (invaderCoreInfo.ticksToCollapse && Game.time < invaderCoreInfo.ticksToCollapse) {
        Game.map.visual.text(invaderCoreInfo.ticksToCollapse - Game.time, new RoomPosition(40, 5, targetRoomName), {
          fontSize: 6,
        });
        return true;
      }
    }
    return false;
  }

  const invaderCore = targetRoom
    .find(FIND_HOSTILE_STRUCTURES)
    .find((structure) => structure.structureType === STRUCTURE_INVADER_CORE);
  if (!invaderCore) {
    delete memory.invaderCore;
    return false;
  }

  const info = {};

  info.level = invaderCore.level;

  if (invaderCore.ticksToDeploy) {
    info.deployTime = Game.time + invaderCore.ticksToDeploy;
    memory.invaderCore = info;
    return false;
  } else {
    const effects = invaderCore.effects;
    for (const effectInfo of effects) {
      if (effectInfo.effect === EFFECT_COLLAPSE_TIMER) {
        info.ticksToCollapse = Game.time + effectInfo.ticksRemaining;
        memory.invaderCore = info;
        return true;
      }
    }
  }
}

Room.prototype.getNormalRemoteSpawnUsage = function (targetRoomName) {
  const remoteStatus = this.getRemoteStatus(targetRoomName);
  const canReserve = this.energyCapacityAvailable >= 650;
  const needBigMiner = this.getNeedBigMiner();

  if (
    remoteStatus &&
    remoteStatus.spawnUsage &&
    remoteStatus.spawnUsage.canReserve === canReserve &&
    remoteStatus.spawnUsage.needBigMiner === needBigMiner
  ) {
    return remoteStatus.spawnUsage;
  }

  const blueprints = this.getRemoteBlueprints(targetRoomName);

  if (!blueprints) {
    return;
  }

  const result = { canReserve, total: 0, resources: {} };

  for (const blueprint of Object.values(blueprints)) {
    const resourceId = blueprint.resourceId;
    result.resources[resourceId] = 0;
    result.resources[resourceId] += needBigMiner ? 20 : 13; // miner
    result.resources[resourceId] += blueprint.maxCarry * (canReserve ? 1.5 : 2); // hauler
    if (!canReserve) {
      result.resources[resourceId] = result.resources[resourceId] * 0.5;
    }

    result.total += result.resources[resourceId];
  }

  if (canReserve) {
    result.reserve = 5;
    result.total += 5;
  }

  result.canReserve = canReserve;
  result.needBigMiner = needBigMiner;

  if (remoteStatus) {
    remoteStatus.spawnUsage = result;
  }

  return result;
};

/**
 * get remote bluePrints
 * @param {String} targetRoomName
 * @returns Object with key sourceId value {resourceId, available, pathLength, maxCarry, structures, isMineral}
 */
Room.prototype.getRemoteBlueprints = function (targetRoomName) {
  const thisName = this.name;

  const remoteStatus = this.getRemoteStatus(targetRoomName);
  if (remoteStatus && remoteStatus.blueprints) {
    return remoteStatus.blueprints;
  }

  const roomType = getRoomType(targetRoomName);

  const startingPoint = this.getStoragePos();
  if (!startingPoint) {
    console.log(`${this.name} has no strage pos`);
    return;
  }

  const targetRoom = Game.rooms[targetRoomName];
  if (!targetRoom) {
    console.log(`${this.name} cannot see ${targetRoomName}`);
    this.deleteRemote(targetRoomName);
    return;
  }

  const array = [];

  const resources = targetRoom.find(FIND_SOURCES);

  const dangerSpots = [];
  if (roomType === 'sourceKeeper') {
    const sourceKeeperLairs = targetRoom
      .find(FIND_HOSTILE_STRUCTURES)
      .filter((structure) => structure.structureType === STRUCTURE_KEEPER_LAIR);

    for (const resource of resources) {
      const spot = { resource };
      const keeperLair = resource.pos.findInRange(sourceKeeperLairs, 5)[0];
      if (keeperLair) {
        spot.keeperLair = dangerSpots.push(spot);
      }
    }
  }

  const roadPositions = [...this.getAllRemoteRoadPositions()];
  const basePlan = this.basePlan;

  const remoteNames = this.getRemoteNames();

  const intermediates = new Set();

  const resourceIdsToHandle = new Set();

  for (const resource of resources) {
    const isMineral = !!resource.mineralType;

    const search = PathFinder.search(
      resource.pos,
      { pos: startingPoint, range: 1 },
      {
        plainCost: 5,
        swampCost: 6, // swampCost higher since road is more expensive on swamp
        maxOps: 20000,
        heuristicWeight: 1,
        roomCallback: function (roomName) {
          if (![thisName, targetRoomName, ...remoteNames].includes(roomName)) {
            return false;
          }

          const costs = new PathFinder.CostMatrix();

          for (const pos of roadPositions) {
            if (pos.roomName === roomName) {
              costs.set(pos.x, pos.y, 4);
            }
          }

          const currentRoom = Game.rooms[roomName];
          if (!currentRoom) {
            return costs;
          }

          currentRoom.find(FIND_STRUCTURES).forEach(function (structure) {
            if (structure.structureType === STRUCTURE_ROAD) {
              costs.set(structure.pos.x, structure.pos.y, 4);
              return;
            }

            if (OBSTACLE_OBJECT_TYPES.includes(structure.structureType)) {
              costs.set(structure.pos.x, structure.pos.y, 255);
              return;
            }
          });

          const currentRoomResources = [...currentRoom.find(FIND_SOURCES), ...currentRoom.find(FIND_MINERALS)];

          for (const currentRoomResource of currentRoomResources) {
            if (resource.id === currentRoomResource.id) {
              continue;
            }
            for (const pos of currentRoomResource.pos.getInRange(1)) {
              if (!pos.isWall && costs.get(pos.x, pos.y) < 50) {
                costs.set(pos.x, pos.y, 50);
              }
            }
          }

          if (roomName === thisName && basePlan) {
            for (let i = 1; i <= 8; i++) {
              for (const structure of basePlan[`lv${i}`]) {
                if (structure.structureType === STRUCTURE_ROAD) {
                  costs.set(structure.pos.x, structure.pos.y, 4);
                  continue;
                }

                if (OBSTACLE_OBJECT_TYPES.includes(structure.structureType)) {
                  costs.set(structure.pos.x, structure.pos.y, 255);
                }
              }
            }
          }

          return costs;
        },
      }
    );

    if (search.incomplete) {
      console.log(`${this.name} cannot find path to resource ${resource.id}`);
      continue;
    }

    const path = search.path;
    const pathLength = path.length;

    if (pathLength > MAX_DISTANCE) {
      console.log(`${this.name} is too far to resource ${resource.id}`);
      continue;
    }

    visualizePath(path);

    roadPositions.push(...path);

    const info = {};

    info.resourceId = resource.id;

    info.available = resource.pos.available;

    info.pathLength = pathLength;

    const structures = [];

    const containerPos = path.shift();

    structures.push(containerPos.packInfraPos('container'));

    for (const pos of path) {
      const roomName = pos.roomName;
      if (![thisName, targetRoomName].includes(roomName)) {
        intermediates.add(roomName);
      }
      structures.push(pos.packInfraPos('road'));

      if (pos.roomName !== targetRoomName) {
        continue;
      }

      if (roomType === 'sourceKeeper' && remoteStatus && !isMineral) {
        for (const spot of dangerSpots) {
          const resource = spot.resource;
          const keeperLair = spot.keeperLair;
          if (pos.findInRange([resource, keeperLair], 5).length > 0) {
            resourceIdsToHandle.add(resource.id);
          }
        }
      }
    }

    info.structures = structures;

    if (isMineral) {
      info.isMineral = true;
      info.mineralType = resource.mineralType;
      info.maxCarry = Math.floor(pathLength * SK_MINERAL_HAULER_RATIO) + 2;
    } else {
      const ratio = roomType === 'normal' ? HAULER_RATIO : SK_HAULER_RATIO;
      const buffer = roomType === 'normal' ? 1 : 2;
      info.maxCarry = path.length * ratio * 0.95 + buffer; // 0.05 for reparing container, 0.5 for buffer
    }

    array.push(info);
  }

  if (array.length === 0) {
    return;
  }

  array.sort((a, b) => a.pathLength - b.pathLength);

  const result = {};

  for (const info of array) {
    result[info.resourceId] = info;
  }

  if (remoteStatus) {
    if (resourceIdsToHandle.size > 0) {
      remoteStatus.resourceIdsToHandle = Array.from(resourceIdsToHandle);
    }

    if (intermediates.size > 0) {
      remoteStatus.intermediates = Array.from(intermediates);
    }
    remoteStatus.roomType = roomType;
    remoteStatus.numSource = array.length;
    remoteStatus.blueprints = result;

    if (roomType === 'normal') {
      remoteStatus.betterSourceId = array[0].resourceId;
      remoteStatus.controllerAvailable = targetRoom.controller.pos.available;
    }
  }

  return result;
};

RoomPosition.prototype.packInfraPos = function (structureType) {
  const coord = this.y * 50 + this.x;
  const roomName = this.roomName;
  return `${roomName} ${coord} ${structureType}`;
};

function unpackInfraPos(packed) {
  const splited = packed.split(' ');
  const roomName = splited[0];
  const coord = splited[1];
  const x = coord % 50;
  const y = (coord - x) / 50;
  return { pos: new RoomPosition(x, y, roomName), structureType: splited[2] };
}

Room.prototype.getAllRemoteRoadPositions = function () {
  const result = [];
  for (const targetRoomName of this.getRemoteNames()) {
    const remoteStatus = this.getRemoteStatus(targetRoomName);
    if (!remoteStatus) {
      continue;
    }

    const blueprint = remoteStatus.blueprints;
    if (!blueprint) {
      continue;
    }

    for (const sourceBlueprint of Object.values(blueprint)) {
      const packedStructures = sourceBlueprint.structures;
      for (const packedStructure of packedStructures) {
        const parsed = unpackInfraPos(packedStructure);
        if (parsed.structureType !== STRUCTURE_ROAD) {
          continue;
        }
        const pos = parsed.pos;
        result.push(pos);
      }
    }
  }
  return result;
};

Room.prototype.getRemoteStatus = function (targetRoomName) {
  this.memory.remotes = this.memory.remotes || {};
  return this.memory.remotes[targetRoomName];
};

Room.prototype.getRemoteNames = function () {
  this.memory.remotes = this.memory.remotes || {};
  return Object.keys(this.memory.remotes);
};

Room.prototype.getStoragePos = function () {
  if (this.storage) {
    return this.storage.pos;
  }
  const basePlan = this.basePlan;
  const lv4 = basePlan['lv4'];
  const storagePlan = lv4.find((plan) => plan.structureType === STRUCTURE_STORAGE);
  if (storagePlan) {
    return storagePlan.pos;
  }
};

function runAway(creep, roomName) {
  const hostileCreeps = creep.room.getEnemyCombatants();

  if (creep.pos.findInRange(hostileCreeps, 5).length > 0) {
    creep.fleeFrom(hostileCreeps, 30, 2);
    return;
  }

  if (hostileCreeps.length > 0 || creep.pos.getRangeToEdge() < 5) {
    creep.moveToRoom(roomName);
  }
}

module.exports = {
  unpackInfraPos,
  isStronghold,
  runAway,
  getInvaderStrengthThreshold,
  SOURCE_KEEPER_RANGE_TO_START_FLEE,
  SOURCE_KEEPER_RANGE_TO_FLEE,
  KEEPER_LAIR_RANGE_TO_START_FLEE,
  KEEPER_LAIR_RANGE_TO_FLEE,
};

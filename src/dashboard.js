const { ResourceColors } = require('./roomVisual_prototype');
const { config } = require('./config');

const OPACITY = 0.5;

Overlord.visualizeRoomInfo = function () {
  const startPos = { x: -0.5, y: 0.5 };
  const numMyRoom = this.myRooms.length;

  if (!config.alwaysShowDashboard) {
    // turn off the showMapInfo after 50 ticks
    if (Memory.showDashboard === 1 && Memory.dashboardTime && Game.time > Memory.dashboardTime + 50) {
      Memory.showDashboard = 0;
    }

    // even if Memory.shoaMapInfo === 0, do mapInfo for every 1000 ticks
    // this is for deleting outdated memories
    if (Memory.showDashboard === 0) {
      visualizeBasicInfo(startPos, numMyRoom);
      return;
    }
  } else {
    Memory.showDashboard = 1;
  }

  new RoomVisual().rect(startPos.x + X_ENTIRE.start, startPos.y - 1, X_ENTIRE.end + 0.5, numMyRoom + 3, {
    fill: 'black',
    opacity: 0.3,
  }); // 틀 만들기

  visualizeBasicInfo(startPos, numMyRoom);

  // 각 방마다 표시
  for (let i = -1; i < numMyRoom; i++) {
    const room = i >= 0 ? this.myRooms[i] : undefined;
    // 각 item마다 표시
    for (const item of items) {
      // 구분선 삽입
      new RoomVisual().text('|', startPos.x + item.end, startPos.y + i + 2, { color: 'cyan', opacity: OPACITY });
      // 처음에는 item 이름
      if (i === -1) {
        new RoomVisual().text(item.name, startPos.x + item.mid, startPos.y + i + 2, {
          color: 'cyan',
          opacity: OPACITY,
        });
        continue;
      }
      // 그다음부터는 내용
      const text = item.text(room);
      const option = text.option;
      option.opacity = OPACITY;
      new RoomVisual().text(text.content, startPos.x + item.mid, startPos.y + i + 2, text.option);
    }
  }

  if (Game.gcl.level >= 3) {
    visualizeResources(numMyRoom);
    visualizePossibleSquad(numMyRoom);
  }
  visualizeTasks();
};

function visualizeBasicInfo(startPos, numMyRoom) {
  const option = { color: 'cyan', strokeWidth: 0.2, align: 'left', opacity: OPACITY };
  new RoomVisual().text('Time ' + Game.time, 0.5, startPos.y, option);
  const cpuAverage = Overlord.getAverageCpu();
  if (cpuAverage) {
    new RoomVisual().text(
      `CPU ${Math.floor(10 * cpuAverage) / 10}/${Game.cpu.limit}(${Math.ceil((1000 * cpuAverage) / Game.cpu.limit) / 10}%)`,
      6,
      startPos.y,
      option
    );
  }
  new RoomVisual().text('Bucket ' + Game.cpu.bucket, 13.5, startPos.y, option);
  new RoomVisual().text(`Room: ${numMyRoom}`, 19.5, startPos.y, option);
  new RoomVisual().text(`Remote: ${Overlord.remoteSources.length}(sources)`, 24, startPos.y, option);
  new RoomVisual().text(`Creep: ${Object.keys(Game.creeps).length}`, 32.5, startPos.y, option);
}

Object.defineProperties(Room.prototype, {
  progressHour: {
    get() {
      return (new Date().getTime() - this.memory.info[0].time) / 1000 / 60 / 60;
    },
  },
  progressPerHour: {
    get() {
      if (this.controller.level === 8) {
        return undefined;
      }
      const progress = this.controller.totalProgress - this.memory.info[0].progress;
      const time = this.progressHour; //시간으로 계산
      return progress / time;
    },
  },
  hoursToNextRCL: {
    get() {
      return (this.controller.progressTotal - this.controller.progress) / this.progressPerHour;
    },
  },
});

Room.prototype.getControlPointsPerTick = function () {
  if (this.controller.level === 8) {
    return undefined;
  }
  if (!this.memory.info) {
    return undefined;
  }
  if (!this.memory.info[0]) {
    return undefined;
  }
  const progressBefore = this.memory.info[0].progress || 0;
  const tickBefore = this.memory.info[0].tick || 0;
  const progress = this.controller.totalProgress - progressBefore;
  const tick = Game.time - tickBefore;
  return progress / tick;
};

global.X_ENTIRE = {
  start: 0,
  end: 0,
};

// item prototype
function VisualItem(name, length, text) {
  // textFunction : (Room) => {text, option}
  this.name = name;
  this.start = X_ENTIRE.end;
  this.end = X_ENTIRE.end = X_ENTIRE.end + length;
  this.mid = (this.start + this.end) / 2;
  this.text = text;
}

// 방 이름
const roomName = new VisualItem('Name', 5, (room) => {
  let emoji = undefined;
  let color = undefined;
  if (room.memory.militaryThreat) {
    emoji = '⚠️';
    color = 'magenta';
  } else if (room.constructionSites.length > 0) {
    emoji = '🧱';
    color = 'yellow';
  } else {
    emoji = '🔼';
    color = 'cyan';
  }
  if (room.memory.defenseNuke) {
    emoji = '☢️' + emoji;
  }
  const content = `${emoji}${room.name}(${room.mineral.mineralType})`;
  const option = { color };
  return { content, option };
});

// RCL
const rcl = new VisualItem('RCL', 3.5, (room) => {
  if (room.controller.level === 8) {
    const content = '8';
    const option = { color: 'lime' };
    return { content, option };
  }
  const content = `${room.controller.level}(${Math.round((100 * room.controller.progress) / room.controller.progressTotal)}%)`;

  const hue = (120 * room.controller.level) / 8;
  const color = `hsl(${hue},100%,60%)`;

  const option = { color };
  return { content, option };
});

// Spawn
const spawnCapacity = new VisualItem('Spawn', 3, (room) => {
  const spawnCapacityRatio = room.getSpawnCapacityRatio();
  const content = `${Math.round(100 * spawnCapacityRatio)}%`;

  const hue = 120 * Math.min(1, 2 - 2 * spawnCapacityRatio);
  const color = `hsl(${hue},100%,60%)`;

  const option = { color };
  return { content, option };
});

// Upgrade Rate
const control = new VisualItem('Control', 3.5, (room) => {
  if (room.controller.level === 8) {
    const content = room.heap.upgrading ? '15e/t' : '-';
    const option = { color: 'lime' };
    return { content, option };
  }
  const controlPointsPerTick = room.getControlPointsPerTick();
  const content = `${Math.floor(10 * controlPointsPerTick) / 10}e/t`;
  const option = { color: controlPointsPerTick > 14 ? 'lime' : controlPointsPerTick > 8 ? 'yellow' : 'magenta' };
  return { content, option };
});

// next RCL
const nextRCL = new VisualItem('next RCL', 4, (room) => {
  const day = Math.floor(room.hoursToNextRCL / 24);
  const hour = Math.floor(10 * (room.hoursToNextRCL % 24)) / 10;
  const leftTime = day === Infinity ? '-' : day > 0 ? `${day}d ${hour}h` : `${hour}h`;
  const content = room.controller.level === 8 ? '-' : leftTime;
  const option = { color: 'cyan' };
  return { content, option };
});

// Energy
const storedEnergy = new VisualItem('Energy', 4.5, (room) => {
  const energyStored = room.getTotalEnergy();
  const content = energyStored ? `${Math.floor(energyStored / 1000)}K(${room.getEnergyLevel()})` : '-';

  const hue = (120 * Math.max(0, room.energyLevel - 50)) / 150;
  const color = `hsl(${hue},100%,60%)`;

  const option = { color };
  return { content, option };
});

// Remote
const remoteIncome = new VisualItem('Remote', 4, (room) => {
  const activeRemotes = room.getActiveRemotes();
  const activeRemoteNames = room.getActiveRemoteNames();

  if (!activeRemoteNames) {
    const content = '-';
    const option = { color: `hsl(0,100%,60%)` };
    return { content, option };
  }

  let income = 0;
  let num = 0;

  for (const info of activeRemotes) {
    const targetRoomName = info.remoteName;
    const remoteStatus = room.getRemoteStatus(targetRoomName);
    if (!remoteStatus) {
      continue;
    }
    if (remoteStatus.block) {
      continue;
    }
    num += info.resourceIds.length;
    const currentIncome = room.getRemoteNetIncomePerTick(targetRoomName);
    const expectedIncome = info.value;
    income += currentIncome;
    Game.map.visual.text(
      `${currentIncome.toFixed(1)}/${expectedIncome.toFixed(1)}`,
      new RoomPosition(25, 12, targetRoomName),
      { fontSize: 5, color: COLOR_NEON_YELLOW, backgroundColor: '#000000', opacity: 1 }
    );
  }

  const totalIncome = Math.floor(10 * income) / 10;
  const content = `${totalIncome}e/t(${num})`;

  const hue = (120 * Math.max(0, totalIncome - num * 2)) / (num * 7);
  const color = `hsl(${hue},100%,60%)`;

  const option = { color };
  return { content, option };
});

// Lab
const lab = new VisualItem('Lab', 3, (room) => {
  if (room.memory.boostState) {
    const content = room.memory.boostState;
    const option = { color: 'lime' };
    return { content, option };
  } else {
    const content = `${room.memory.labTarget ? room.memory.labTarget : '-'}`;
    const option = { color: room.memory.labTarget ? 'lime' : room.memory.labs ? 'yellow' : 'magenta' };
    return { content, option };
  }
});

//power
const powerProcess = new VisualItem('Power', 3, (room) => {
  const content = room.heap.powerProcessing ? 'active' : '-';
  const option = { color: 'lime' };
  return { content, option };
});

// Rampart
const rampart = new VisualItem('Rampart', 4, (room) => {
  const value = Math.round(room.structures.minProtectionHits / 10000) / 100;
  const content = `${value}M`;

  const hue = (120 * value) / 10;
  const color = `hsl(${hue},100%,60%)`;

  const option = { color };
  return { content, option };
});

// 표시할 정보 목록
const items = [roomName, rcl, spawnCapacity, control, nextRCL, storedEnergy, remoteIncome, lab, powerProcess, rampart];

function visualizeResources(numMyRoom) {
  const stats = Memory.stats;
  if (!stats) {
    return;
  }
  const resources = Memory.stats.resources;
  if (!resources) {
    return;
  }

  const resourcesByTier = {
    0: [...BASIC_MINERALS, 'G', 'power'],
    1: Object.keys(TIER1_COMPOUNDS),
    2: Object.keys(TIER2_COMPOUNDS),
    3: Object.keys(TIER3_COMPOUNDS),
  };
  const length = Math.max(...Object.values(resourcesByTier).map((array) => array.length));

  const topLeftCorner = { x: -0.5, y: numMyRoom + 3 };

  new RoomVisual().rect(topLeftCorner.x + X_ENTIRE.start, topLeftCorner.y, X_ENTIRE.end + 0.5, length + 2, {
    fill: 'black',
    opacity: 0.3,
  }); // 틀 만들기

  for (let i = 0; i <= 3; i++) {
    const x = topLeftCorner.x + 1 + (5 + 0.3 * i) * i;
    new RoomVisual().text(`|`, x - 0.5, topLeftCorner.y + 1, { color: 'cyan', align: 'left' });
    new RoomVisual().text(`T${i} Resources`, x, topLeftCorner.y + 1, {
      color: 'cyan',
      align: 'left',
      opacity: OPACITY,
    });
    const resourceTypes = resourcesByTier[i];
    for (let j = 0; j < length; j++) {
      const y = topLeftCorner.y + 2 + j;
      new RoomVisual().text(`|`, x - 0.5, y, { color: 'cyan', align: 'left' });

      const resourceType = resourceTypes[j];

      if (!resourceType) {
        continue;
      }

      const amount = resources[resourceType] || 0;

      new RoomVisual().text(`${resourceType}: ${amount.toLocaleString()}`, x, y, {
        color: ResourceColors[resourceType][0],
        align: 'left',
        opacity: OPACITY,
      });
    }
  }
}

function visualizePossibleSquad(numMyRoom) {
  const middleMiddleCorner = { x: 26, y: numMyRoom + 4 };
  const numAvailableBlinkyQuad = Overlord.getNumAvailableBlinkyQuad();
  new RoomVisual().text(`|`, middleMiddleCorner.x - 0.5, middleMiddleCorner.y, { color: 'cyan', align: 'left' });
  new RoomVisual().text(`Quad Blinky Possible`, middleMiddleCorner.x, middleMiddleCorner.y, {
    color: 'cyan',
    align: 'left',
    opacity: OPACITY,
  });
  let j = 1;
  for (const i in numAvailableBlinkyQuad) {
    const x = middleMiddleCorner.x;
    const y = middleMiddleCorner.y + j;
    j++;
    new RoomVisual().text(`|`, x - 0.5, y, { color: 'cyan', align: 'left' });
    new RoomVisual().text(`Quad Blinky ${i}: ${numAvailableBlinkyQuad[i]}`, x, y, {
      color: COLOR_NEON_GREEN,
      align: 'left',
      opacity: OPACITY,
    });
  }

  const bottomMiddleCorner = { x: 26, y: middleMiddleCorner.y + 7 };
  const numAvailableDuo = Overlord.getNumAvailableDuo();

  new RoomVisual().text(`|`, bottomMiddleCorner.x - 0.5, bottomMiddleCorner.y, { color: 'cyan', align: 'left' });
  new RoomVisual().text(`Duo Possible`, bottomMiddleCorner.x, bottomMiddleCorner.y, {
    color: 'cyan',
    align: 'left',
    opacity: OPACITY,
  });
  for (let i = 1; i <= 3; i++) {
    const x = bottomMiddleCorner.x;
    const y = bottomMiddleCorner.y + i;
    new RoomVisual().text(`|`, x - 0.5, y, { color: 'cyan', align: 'left' });
    new RoomVisual().text(`Ant T${i}: ${numAvailableDuo['ant'][i] || 0}`, x, y, {
      color: COLOR_NEON_RED,
      align: 'left',
      opacity: OPACITY,
    });

    new RoomVisual().text(`|`, x + 4.5, y, { color: 'cyan', align: 'left' });
    new RoomVisual().text(`Worm T${i}: ${numAvailableDuo['worm'][i] || 0}`, x + 5, y, {
      color: COLOR_NEON_YELLOW,
      align: 'left',
      opacity: OPACITY,
    });
  }
}

function visualizeTasks() {
  const topRightCorner = { x: 37.5, y: -0.5 };

  const tasks = Overlord.tasks;
  let i = 1;
  for (const category in tasks) {
    const requests = Object.values(tasks[category]);
    if (requests.length === 0) {
      continue;
    }
    new RoomVisual().text(`|`, topRightCorner.x, topRightCorner.y + i, { color: 'cyan', align: 'left' });
    new RoomVisual().text(category.toUpperCase(), topRightCorner.x + 0.5, topRightCorner.y + i, {
      color: 'cyan',
      align: 'left',
      opacity: OPACITY,
    });
    i++;
    for (const request of requests) {
      new RoomVisual().text(`|`, topRightCorner.x, topRightCorner.y + i, { color: 'cyan', align: 'left' });
      new RoomVisual().text(
        `${request.currentRoom || request.roomNameInCharge}➔${request.roomName}`,
        topRightCorner.x + 0.5,
        topRightCorner.y + i,
        { color: COLOR_NEON_YELLOW, align: 'left', opacity: OPACITY, font: 0.7 }
      );
      switch (category) {
        case 'quad':
          new RoomVisual().text(
            `(${request.status.toUpperCase()}) (${request.ticksToLive})`,
            49.5,
            topRightCorner.y + i,
            { color: COLOR_NEON_YELLOW, align: 'right', opacity: OPACITY, font: 0.6 }
          );
          break;
        case 'duo':
          new RoomVisual().text(
            `(${request.status.toUpperCase()}) (${request.ticksToLive})`,
            49.5,
            topRightCorner.y + i,
            { color: COLOR_NEON_YELLOW, align: 'right', opacity: OPACITY, font: 0.6 }
          );
          break;
        case 'guard':
          new RoomVisual().text(
            `(${request.status.toUpperCase()}) (${Game.time - request.startTime})`,
            49.5,
            topRightCorner.y + i,
            { color: COLOR_NEON_YELLOW, align: 'right', opacity: OPACITY, font: 0.6 }
          );
          break;
        case 'siege':
          new RoomVisual().text(`(${request.endTime - Game.time})`, 49.5, topRightCorner.y + i, {
            color: COLOR_NEON_YELLOW,
            align: 'right',
            opacity: OPACITY,
            font: 0.6,
          });
          break;
        case 'occupy':
          new RoomVisual().text(`(${request.endTime - Game.time})`, 49.5, topRightCorner.y + i, {
            color: COLOR_NEON_YELLOW,
            align: 'right',
            opacity: OPACITY,
            font: 0.6,
          });
          break;
        case 'blinky':
          new RoomVisual().text(`(${request.ticksToLive})`, 49.5, topRightCorner.y + i, {
            color: COLOR_NEON_YELLOW,
            align: 'right',
            opacity: OPACITY,
            font: 0.6,
          });
          break;
        default:
      }
      i++;
    }
    new RoomVisual().text(` ------------------------------`, topRightCorner.x + 0.5, topRightCorner.y + i, {
      color: 'cyan',
      align: 'left',
    });
    i++;
  }

  const harassing = Game.harassing;
  if (harassing) {
    new RoomVisual().text(`|`, topRightCorner.x, topRightCorner.y + i, { color: 'cyan', align: 'left' });
    new RoomVisual().text('HARASSING', topRightCorner.x + 0.5, topRightCorner.y + i, {
      color: 'cyan',
      align: 'left',
      opacity: OPACITY,
    });
    i++;
    for (const info of Object.values(harassing)) {
      new RoomVisual().text(`|`, topRightCorner.x, topRightCorner.y + i, { color: 'cyan', align: 'left' });
      new RoomVisual().text(
        `${info.current}➔${info.goal} (${info.ticksToLive})`,
        topRightCorner.x + 0.5,
        topRightCorner.y + i,
        { color: COLOR_NEON_YELLOW, align: 'left', opacity: OPACITY }
      );
      i++;
    }
  }

  new RoomVisual().rect(topRightCorner.x, topRightCorner.y, 50 - topRightCorner.x, i, {
    fill: 'black',
    opacity: 0.3,
  }); // 틀 만들기
}

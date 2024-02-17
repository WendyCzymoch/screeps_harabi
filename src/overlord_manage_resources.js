const { config } = require('./config');
const { EFunnelGoalType } = require('./simpleAllies');

Overlord.getBestFunnelRequest = function () {
  if (Game._bestFunnelRequest !== undefined) {
    return Game._bestFunnelRequest;
  }

  const myFunnelRequest = getMyFunnelRequest();
  const allyFunnelRequest = getAllyFunnelRequest();

  if (myFunnelRequest && allyFunnelRequest) {
    return (Game._bestFunnelRequest =
      myFunnelRequest.maxAmount <= allyFunnelRequest.maxAmount ? myFunnelRequest : allyFunnelRequest);
  }

  return (Game._bestFunnelRequest = myFunnelRequest || allyFunnelRequest);
};

function getAllyFunnelRequest() {
  const allyRequests = Memory.simpleAlliesCache;
  if (!allyRequests) {
    return undefined;
  }

  let result = undefined;

  try {
    for (const allyName in allyRequests) {
      if (!allyRequests[allyName]) {
        continue;
      }
      const requests = allyRequests[allyName].requests;
      if (!requests) {
        continue;
      }
      const funnelRequests = requests.funnel;
      if (!funnelRequests) {
        continue;
      }
      for (const request of funnelRequests) {
        if (!result) {
          result = request;
          continue;
        }
        if (request.maxAmount && request.maxAmount < result.maxAmount) {
          result = request;
          continue;
        }
      }
    }
  } catch (err) {
    data.recordError(err, 'getAllyFunnelRequest');
  }

  return result;
}

function getMyFunnelRequest() {
  const myFunnelList = Overlord.getMyFunnelList();

  for (const request of myFunnelList) {
    const roomName = request.roomName;
    const room = Game.rooms[roomName];
    if (!room || !room.isMy) {
      continue;
    }

    if (room.energyLevel >= config.energyLevel.STOP_FUNNEL) {
      request.enough = true;
    }

    return request;
  }

  return undefined;
}

Overlord.getMyFunnelList = function () {
  if (Game._myFunnelList !== undefined) {
    return Game._myFunnelList;
  }
  return (Game._myFunnelList = getMyFunnelList());
};

function getMyFunnelList() {
  const myRooms = Overlord.myRooms;

  const result = [];

  for (const room of myRooms) {
    if (!room.terminal || !room.terminal.RCLActionable || !room.storage || room.abandon) {
      continue;
    }

    const level = room.controller.level;

    if (level !== 6) {
      continue;
    }

    const goalType = level === 6 ? EFunnelGoalType.RCL7 : level === 7 ? EFunnelGoalType.RCL8 : undefined;

    if (!goalType) {
      continue;
    }

    const amount = getFunnelAmount(room);

    const request = {
      maxAmount: amount,
      goalType,
      roomName: room.name,
    };
    result.push(request);
  }

  result.sort((a, b) => a.goalType - b.goalType || a.maxAmount - b.maxAmount);

  for (let i = 0; i < result.length; i++) {
    const request = result[i];
    request.priority = i;
  }

  return result;
}

function getFunnelAmount(room) {
  return room.controller.progressTotal - room.controller.progress;
}

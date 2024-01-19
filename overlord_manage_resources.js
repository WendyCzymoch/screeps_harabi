const { config } = require("./config")
const { EFunnelGoalType } = require("./simpleAllies")

Overlord.getBestFunnelRequest = function () {
  if (Game._bestFunnelRequest !== undefined) {
    return Game._bestFunnelRequest
  }

  const myFunnelRequest = getMyFunnelRequest()
  const allyFunnelRequest = getAllyFunnelRequest()

  if (myFunnelRequest && allyFunnelRequest) {
    return Game._bestFunnelRequest = ((myFunnelRequest.maxAmount <= allyFunnelRequest.maxAmount) ? myFunnelRequest : allyFunnelRequest)
  }

  return Game._bestFunnelRequest = (myFunnelRequest || allyFunnelRequest)
}

function getAllyFunnelRequest() {
  const allyRequests = Memory.simpleAlliesCache
  if (!allyRequests) {
    return undefined
  }

  let result = undefined

  try {
    for (const allyName in allyRequests) {
      if (!allyRequests[allyName]) {
        continue
      }
      const requests = allyRequests[allyName].requests
      if (!requests) {
        continue
      }
      const funnelRequests = requests.funnel
      if (!funnelRequests) {
        continue
      }
      for (const request of funnelRequests) {
        if (!result) {
          result = request
          continue
        }
        if (request.maxAmount && request.maxAmount < result.maxAmount) {
          result = request
          continue
        }
      }
    }
  } catch (err) {
    console.log(err)
  }

  return result
}

function getMyFunnelRequest() {
  const myRooms = Overlord.myRooms
  const myRoomsRCL6 = []
  const myRoomsRCL7 = []

  for (const room of myRooms) {
    if (!room.terminal || !room.terminal.RCLActionable || !room.storage) {
      continue
    }
    const level = room.controller.level
    if (level === 6) {
      myRoomsRCL6.push(room)
    }
    if (level === 7) {
      myRoomsRCL7.push(room)
    }
  }

  if (myRoomsRCL6.length > 0) {
    let minAmount = Infinity
    let minRoom = undefined

    for (const room of myRoomsRCL6) {
      const amount = getFunnelAmount(room)
      if (amount < minAmount) {
        minAmount = amount
        minRoom = room
      }
    }

    if (minRoom.energyLevel < config.energyLevel.STOP_FUNNEL) {
      const result = {
        maxAmount: minAmount,
        goalType: EFunnelGoalType.RCL7,
        roomName: minRoom.name
      }
      return result
    }
  }

  if (myRoomsRCL7.length > 0) {
    let minAmount = Infinity
    let minRoom = undefined

    for (const room of myRoomsRCL7) {
      const amount = getFunnelAmount(room)
      if (amount < minAmount) {
        minAmount = amount
        minRoom = room
      }
    }

    if (minRoom.energyLevel < config.energyLevel.STOP_FUNNEL) {
      const result = {
        maxAmount: minAmount,
        goalType: EFunnelGoalType.RCL8,
        roomName: minRoom.name
      }
      return result
    }
  }

  return undefined
}

function getFunnelAmount(room) {
  return room.controller.progressTotal - room.controller.progress
}
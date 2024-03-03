const { BlinkyRequest } = require('./overlord_tasks_blinky')

global.claimRoom = function (targetRoomName, baseName = undefined) {
  targetRoomName = targetRoomName.toUpperCase()
  const tasks = Overlord.getTasksWithCategory('claim')
  if (tasks[targetRoomName]) {
    return ERR_FULL
  }

  const base = baseName ? Game.rooms[baseName.toUpperCase()] : Overlord.findClosestMyRoom(targetRoomName, 4, 12)

  if (!base) {
    return ERR_NOT_IN_RANGE
  }

  const request = new ClaimRequest(base, targetRoomName)

  Overlord.registerTask(request)

  return OK
}

Overlord.manageClaimTasks = function () {
  const tasks = this.getTasksWithCategory('claim')

  for (const request of Object.values(tasks)) {
    const roomNameInCharge = request.roomNameInCharge
    const roomInCharge = Game.rooms[roomNameInCharge]

    if (!roomInCharge) {
      this.deleteTask(request)
      data.recordLog(
        `CLAIM: ${roomNameInCharge} claim ${request.roomName} completed. no room in charge`,
        request.roomName
      )
      continue
    }

    if (request.complete) {
      data.recordLog(
        `CLAIM: ${roomNameInCharge} claim ${request.roomName} completed. result ${request.result}`,
        request.roomName
      )
      this.deleteTask(request)

      if (request.result !== 'success') {
        const intel = Overlord.getIntel(request.roomName)
        intel[scoutKeys.claimFailure] = intel[scoutKeys.claimFailure] || 0
        intel[scoutKeys.claimFailure] += 1
        delete intel[scoutKeys.claimScore]
      }
      continue
    }

    roomInCharge.runClaimTask(request)
  }
}

Room.prototype.runClaimTask = function (request) {
  const roomName = request.roomName

  if (this.memory.militaryThreat) {
    request.complete = true
    request.result = 'threat'
    return
  }

  if (Game.time > request.startTime + 20 * CREEP_LIFE_TIME) {
    request.result = 'expire'
    request.complete = true
    return
  }

  // targetRoom (안보이면 undefined)
  const targetRoom = Game.rooms[roomName]

  if (targetRoom && targetRoom.controller.owner && targetRoom.controller.owner.username !== MY_NAME) {
    request.result = 'taken'
    request.complete = true
    return
  }

  if (
    request.isClaimed &&
    (!targetRoom || !targetRoom.controller.owner || targetRoom.controller.owner.username !== MY_NAME)
  ) {
    request.result = 'unclaimed'
    request.complete = true
    return
  }

  // defense part
  const tasks = Overlord.getTasksByRoomInCharge(this.name)
  const blinkyTasks = Object.values(tasks['blinky'])

  if (!blinkyTasks.some((request) => request.ticksToLive > 900)) {
    const request = new BlinkyRequest(this, roomName, { number: 1, boost: 0 })
    Overlord.registerTask(request)
  }

  if (targetRoom) {
    const invaderCore = targetRoom
      .find(FIND_HOSTILE_STRUCTURES)
      .find((structure) => structure.structureType === STRUCTURE_INVADER_CORE)

    if (invaderCore) {
      const coreAttackers = Overlord.getCreepsByRole(roomName, 'coreAttacker')
      if (coreAttackers.length === 0) {
        this.requestCoreAttacker(roomName)
      }
    }

    if (targetRoom.controller.reservation && targetRoom.controller.reservation.username !== MY_NAME) {
      const reservers = Overlord.getCreepsByRole(roomName, 'reserver')
      if (reservers.length === 0) {
        this.requestReserver(roomName)
      }
    }
  }

  // claim part

  if (!request.isClaimed) {
    if (targetRoom && targetRoom.isMy) {
      request.isClaimed = true
    } else {
      const claimer = Overlord.getCreepsByRole(roomName, 'claimer')[0]
      if (!claimer) {
        this.requestClaimer(roomName)
      }
    }
  }

  // clear part
  if (request.isClaimed && !request.isCleared) {
    for (const site of targetRoom.find(FIND_HOSTILE_CONSTRUCTION_SITES)) {
      site.remove()
    }

    const structures = targetRoom.find(FIND_STRUCTURES)

    let numLeft = 0

    let numDone = 0

    for (const structure of structures) {
      // 내 건물은 넘어가
      if (structure.my) {
        continue
      }

      // road, container 등은 한 번만 부수고 그담부턴 넘어가
      if (!structure.owner && request.isClearedOnce) {
        continue
      }

      // 남아있던 건물들은 에너지 있는 동안은 냅둬
      if (
        structure.owner &&
        structure.store &&
        structure.store[RESOURCE_ENERGY] > 100 &&
        targetRoom.controller.level < 4
      ) {
        numLeft++
        continue
      }
      numDone++
      structure.destroy()
    }

    if (numDone === 0) {
      request.isClearedOnce = true
    }

    if (numLeft === 0 && numDone === 0) {
      request.isCleared = true
    }
  }

  // 아직 claim 안된거면 여기서 멈춰
  if (!request.isClaimed) {
    return
  }

  // 작동하는 타워까지 있으면 이제 claim 끝
  const spawn = targetRoom.structures.spawn[0]

  const towerActive = targetRoom.structures.tower.filter(
    (tower) => tower.RCLActionable && tower.store[RESOURCE_ENERGY] > 0
  )

  // rampart
  if (spawn && towerActive.length > 0 && !spawn.pos.isRampart) {
    spawn.pos.createConstructionSite('rampart')
  }

  for (const tower of towerActive) {
    if (tower && !tower.pos.isRampart) {
      tower.pos.createConstructionSite('rampart')
    }
  }

  if (targetRoom && spawn && towerActive.length > 0 && request.isCleared) {
    request.complete = true
    request.result = 'success'
    return
  }

  // pioneer part

  if (spawn) {
    request.saveCPU = false
    // don't send pioneers when there is spawn
    return
  } else {
    request.saveCPU = true
    // save CPU while building spawn. this room will use much CPU after spawn built.
  }

  const pioneers = Overlord.getCreepsByRole(roomName, 'pioneer').filter(
    (creep) => creep.spawning || creep.ticksToLive > CREEP_LIFE_TIME - 600
  )

  let numWork = 0

  for (const pioneer of pioneers) {
    numWork += pioneer.getNumParts('work')
  }

  let number = pioneers.length > 0 ? Math.max(...pioneers.map((pioneer) => pioneer.memory.number)) : 0
  if (numWork < 20) {
    number++
    return this.requestPioneer(roomName, number)
  }
}

const ClaimRequest = function (room, targetRoomName, options) {
  const defaultOptions = {}
  const mergedOptions = { ...defaultOptions, ...options }
  const {} = mergedOptions

  this.category = 'claim'

  this.id = targetRoomName

  this.startTime = Game.time

  this.roomName = targetRoomName

  this.roomNameInCharge = room.name
}

module.exports = {
  ClaimRequest,
}

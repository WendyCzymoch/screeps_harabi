INTEL_EXPIRATION_TICK = 60000

global.Overlord = {
  get memory() {
    if (Memory.overlord) {
      return Memory.overlord
    }
    return Memory.overlord = {}
  },
  get heap() {
    return Heap.overlord
  },
  get myRooms() {
    if (Game._myRooms) {
      return Game._myRooms
    }
    return Game._myRooms = Object.values(Game.rooms).filter(room => room.isMy).sort((a, b) => b.controller.totalProgress - a.controller.totalProgress)
  },
  get structures() {
    if (Game._structures) {
      return Game._structures
    }
    Game._structures = {}
    const overlordStructureTypes = ['terminal', 'observer']
    for (const structureType of overlordStructureTypes) {
      Game._structures[structureType] = []
    }
    for (const room of this.myRooms) {
      for (const structureType of overlordStructureTypes) {
        if (room.structures[structureType].length) {
          Game._structures[structureType].push(room.structures[structureType][0])
        }
      }

    }
    return Game._structures
  },
  get remotes() {
    if (Game._remotes) {
      return Game._remotes
    }
    Game._remotes = []
    for (const myRoom of this.myRooms) {
      const activeRemotes = myRoom.memory.activeRemotes
      if (!activeRemotes) {
        continue
      }
      Game._remotes.push(...activeRemotes)
    }
    return Game._remotes
  },
  get deposits() {
    Memory._deposits = Memory._deposits || {}
    return Memory._deposits
  },
  get powerBanks() {
    Memory._powerBanks = Memory._powerBanks || {}
    return Memory._powerBanks
  }
}

Overlord.mapInfo = function () {
  if (Memory.showMapInfo === 0) {
    return
  }

  for (const roomName in Memory.rooms) {
    const intel = Overlord.getIntel(roomName)

    if (intel.lastScout === undefined || (Game.time > intel.lastScout + INTEL_EXPIRATION_TICK)) {
      delete Memory.rooms[roomName]
      continue
    }

    const center = new RoomPosition(25, 25, roomName)

    if (intel.isClaimCandidate) {
      Game.map.visual.text(`🚩`, new RoomPosition(center.x - 15, center.y, center.roomName), { fontSize: 7, })
      Game.map.visual.text(`⚡${intel.numSource}/2`, new RoomPosition(center.x + 12, center.y, center.roomName), { fontSize: 7, })
      Game.map.visual.text(`💎${intel.mineralType}`, new RoomPosition(center.x, center.y - 15, center.roomName), { fontSize: 7, })
    }

    if (intel.inaccessible && intel.inaccessible > Game.time) {
      Game.map.visual.text(`🚫${intel.inaccessible - Game.time}`, new RoomPosition(center.x, center.y - 13, center.roomName), { fontSize: 7, color: '#f000ff' })
    }

    if (intel.reservationOwner) {
      Game.map.visual.text(`${intel.reservationOwner}`, new RoomPosition(center.x, center.y - 15, center.roomName), { fontSize: 7, })
    }

    if (intel.owner && !intel.isMy) {
      Game.map.visual.text(`${intel.owner}`, center, { fontSize: 7, backgroundColor: '#000000', opacity: 1 })

    }

    // 내 방인지 체크
    const room = Game.rooms[roomName]
    if (room && room.isMy) {
      Game.map.visual.text(`${room.controller.level}`, new RoomPosition(center.x, center.y, center.roomName), { fontSize: 13, color: '#000000' })
      if (room.memory.scout) {
        Game.map.visual.text(`⏰${Game.time - room.memory.scout.startTick}`, new RoomPosition(center.x + 23, center.y - 16, center.roomName), { align: 'right', fontSize: 5, color: '#74ee15' })

        Game.map.visual.text(`${room.memory.scout.state}`, new RoomPosition(center.x - 23, center.y - 18, center.roomName), { align: 'left', fontSize: 13, color: '#74ee15' })
        if (room.memory.scout.next) {
          Game.map.visual.line(center, new RoomPosition(25, 25, room.memory.scout.next), { color: '#ffe700', width: '2', opacity: 1 })
          Game.map.visual.circle(new RoomPosition(25, 25, room.memory.scout.next), { fill: '#ffe700' })
        }
      }
    }
  }
}

Overlord.observeRoom = function (roomName) {
  data.info = false
  const observer = this.structures.observer.find(observer => Game.map.getRoomLinearDistance(observer.room.name, roomName) <= 10)
  if (observer) {
    observer.observeRoom(roomName)
  }
}

Overlord.getNumCreepsByRole = function (roomName, role) {
  const creeps = this.classifyCreeps()
  if (!creeps[roomName]) {
    return 0
  }
  if (!creeps[roomName][role]) {
    return 0
  }
  return creeps[roomName][role].length
}

Overlord.getCreepsByRole = function (roomName, role) {
  const creeps = this.classifyCreeps()
  if (!creeps[roomName]) {
    return []
  }
  if (!creeps[roomName][role]) {
    return []
  }
  return [...creeps[roomName][role]]
}

Overlord.getCreepsByAssignedRoom = function (roomName) {
  const creeps = this.classifyCreeps()
  if (!creeps[roomName]) {
    return []
  }
  const result = []
  for (const roleName in creeps[roomName]) {
    result.push(...creeps[roomName][roleName])
  }
  return result
}

Overlord.classifyCreeps = function () {
  if (this._classifyCreepsTick === Game.time && this._classifiedCreeps) {
    return this._classifiedCreeps
  }

  this._classifyCreepsTick = Game.time

  const creeps = Object.values(Game.creeps)
  const result = {}
  for (const roomName of Object.keys(Game.rooms)) {
    result[roomName] = {}
    for (const creepRole of CREEP_ROELS) {
      result[roomName][creepRole] = []
    }
    result[roomName].wounded = []
  }
  result.independents = []


  for (const creep of creeps) {
    if (Game.time % 10 === 0 && !creep.memory.notify && creep.ticksToLive < CREEP_LIFE_TIME) {
      creep.notifyWhenAttacked(false)
      creep.memory.notify = true
    }

    if (result[creep.assignedRoom] === undefined) {
      result[creep.assignedRoom] = {}
    }

    if (creep.hits < creep.hitsMax) {
      if (result[creep.assignedRoom].wounded === undefined) {
        result[creep.assignedRoom].wounded = []
      }
      result[creep.assignedRoom].wounded.push(creep)
    }

    if (creep.memory.role) {
      if (!creep.spawning && SELF_DIRECTED_CREEP_ROELS.includes(creep.memory.role)) {
        result.independents.push(creep)
      }

      if (result[creep.assignedRoom][creep.memory.role] === undefined) {
        result[creep.assignedRoom][creep.memory.role] = []
      }
      result[creep.assignedRoom][creep.memory.role].push(creep)
    }
  }

  this._classifiedCreeps = result

  return result
}

Object.defineProperties(Creep.prototype, {
  assignedRoom: {
    get() {
      if (this.memory.assignedRoom) {
        return this.memory.assignedRoom
      }
      const splitedName = this.name.split(' ')
      return splitedName[0]
    }
  },
  originalRole: {
    get() {
      const splitedName = this.name.split(' ')
      return splitedName[1]
    }
  }
})

Overlord.memHack = {
  memory: null,
  parseTime: -1,
  register() {
    const start = Game.cpu.getUsed()
    this.memory = Memory
    const end = Game.cpu.getUsed()
    this.parseTime = end - start
    console.log(this.parseTime)
    this.memory = RawMemory._parsed
  },
  pretick() {
    delete global.Memory
    global.Memory = this.memory
    RawMemory._parsed = this.memory
  }
}

Overlord.memHack.register()
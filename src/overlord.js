const { config } = require('./config')
const { toTwoDigits } = require('./data')

const profiler = require('screeps-profiler')

INTEL_EXPIRATION_TICK = 60000

global.Overlord = {
  get memory() {
    if (Memory.overlord) {
      return Memory.overlord
    }
    return (Memory.overlord = {})
  },

  get heap() {
    return Heap.overlord
  },

  get myRooms() {
    if (Game._myRooms) {
      return Game._myRooms
    }
    return (Game._myRooms = Object.values(Game.rooms)
      .filter((room) => room.isMy)
      .sort((a, b) => b.controller.totalProgress - a.controller.totalProgress))
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
      const activeRemotes = myRoom.getActiveRemotes()
      if (!activeRemotes) {
        continue
      }
      for (const activeRemoteInfo of activeRemotes) {
        if (activeRemoteInfo.block) {
          continue
        }
        Game._remotes.push(activeRemoteInfo.remoteName)
      }
    }
    return Game._remotes
  },

  get remoteSources() {
    if (Game._remoteSources) {
      return Game._remoteSources
    }
    Game._remoteSources = []
    for (const myRoom of this.myRooms) {
      const activeRemotes = myRoom.getActiveRemotes()
      if (!activeRemotes) {
        continue
      }
      for (const activeRemoteInfo of activeRemotes) {
        if (activeRemoteInfo.block) {
          continue
        }
        Game._remoteSources.push(...activeRemoteInfo.resourceIds)
      }
    }
    return Game._remoteSources
  },

  get deposits() {
    Memory._deposits = Memory._deposits || {}
    return Memory._deposits
  },

  get powerBanks() {
    Memory._powerBanks = Memory._powerBanks || {}
    return Memory._powerBanks
  },
}

Overlord.mapInfo = function () {
  if (!config.alwaysShowMapInfo) {
    // turn off the showMapInfo after 50 ticks
    if (Memory.showMapInfo === 1 && Memory.mapInfoTime && Game.time > Memory.mapInfoTime + 50) {
      Memory.showMapInfo = 0
    }

    // even if Memory.shoaMapInfo === 0, do mapInfo for every 1000 ticks
    // this is for deleting outdated memories
    if (Memory.showMapInfo === 0 && Game.time % 1000 !== 0) {
      return
    }
  } else {
    Memory.showMapInfo = 1
  }

  for (const roomName in Memory.rooms) {
    const intel = Overlord.getIntel(roomName)

    if (intel[scoutKeys.lastScout] === undefined || Game.time > intel[scoutKeys.lastScout] + INTEL_EXPIRATION_TICK) {
      delete Memory.rooms[roomName]
      continue
    }

    const center = new RoomPosition(25, 25, roomName)

    if (intel[scoutKeys.claimScore] && intel[scoutKeys.claimScore] >= 0.7) {
      Game.map.visual.text(intel[scoutKeys.claimScore], center, { fontSize: 7 })
      Game.map.visual.text(`🚩`, new RoomPosition(center.x - 15, center.y - 15, center.roomName), { fontSize: 7 })
      Game.map.visual.text(
        `⚡${intel[scoutKeys.numSource]}/2`,
        new RoomPosition(center.x + 12, center.y + 15, center.roomName),
        { fontSize: 7 }
      )
      Game.map.visual.text(
        `💎${intel[scoutKeys.mineralType]}`,
        new RoomPosition(center.x - 12, center.y + 15, center.roomName),
        { fontSize: 7 }
      )
    }

    const inaccessible = intel[scoutKeys.inaccessible]
    if (!intel[scoutKeys.isMy] && ((inaccessible && inaccessible > Game.time) || intel[scoutKeys.numTower] > 0)) {
      Game.map.visual.text(`🚫`, new RoomPosition(center.x + 15, center.y - 15, center.roomName), {
        fontSize: 7,
        color: '#f000ff',
      })
    }

    if (intel[scoutKeys.reservationOwner] && intel[scoutKeys.reservationOwner] !== MY_NAME) {
      Game.map.visual.text(
        `${intel[scoutKeys.reservationOwner]}`,
        new RoomPosition(center.x, center.y - 15, center.roomName),
        { fontSize: 7 }
      )
    }

    if (intel[scoutKeys.owner] && !intel[scoutKeys.isMy]) {
      Game.map.visual.text(`${intel[scoutKeys.owner]}`, center, {
        fontSize: 7,
        backgroundColor: '#000000',
        opacity: 1,
      })
    }

    // 내 방인지 체크
    const room = Game.rooms[roomName]
    if (room && room.isMy) {
      Game.map.visual.text(`${room.controller.level}`, new RoomPosition(center.x, center.y, center.roomName), {
        fontSize: 13,
        color: '#000000',
      })
      if (room.memory.scout) {
        Game.map.visual.text(
          `⏰${Game.time - room.memory.scout.startTick}`,
          new RoomPosition(center.x + 23, center.y - 16, center.roomName),
          { align: 'right', fontSize: 5, color: '#74ee15' }
        )

        Game.map.visual.text(
          `${room.memory.scout.state}`,
          new RoomPosition(center.x - 23, center.y - 18, center.roomName),
          { align: 'left', fontSize: 10, color: '#74ee15' }
        )
        if (room.memory.scout.next) {
          Game.map.visual.line(center, new RoomPosition(25, 25, room.memory.scout.next), {
            color: '#ffe700',
            width: '1',
            opacity: 0.5,
          })
          Game.map.visual.circle(new RoomPosition(25, 25, room.memory.scout.next), { radius: 5, fill: '#ffe700' })
        }
      }

      if (config.seasonNumber === 6) {
        const status = Game.map.getRoomStatus(roomName)
        const timestampNow = new Date().getTime()
        const timestampClose = status.timestamp

        const difference = Math.floor(new Date(timestampClose - timestampNow) / 1000)

        const day = toTwoDigits(Math.floor(difference / 60 / 60 / 24))

        const dayRemainder = difference % (60 * 60 * 24)

        const hour = toTwoDigits(Math.floor(dayRemainder / 60 / 60))

        const hourRemainder = dayRemainder % (60 * 60)

        const minutes = Math.floor(hourRemainder / 60)

        const seconds = toTwoDigits(hourRemainder % 60)

        Game.map.visual.text(`${day} Days and ${hour}:${minutes}:${seconds}`, new RoomPosition(25, 45, roomName), {
          fontSize: 5,
          color: '#74ee15',
        })
      }
    }
  }
}

Overlord.getSecondsToClose = function (roomName) {
  if (config.seasonNumber !== 6) {
    return
  }
  const status = Game.map.getRoomStatus(roomName)

  const timestampNow = new Date().getTime()
  const timestampClose = status.timestamp

  if (!timestampClose) {
    return
  }

  return Math.floor(new Date(timestampClose - timestampNow) / 1000)
}

Overlord.observeRoom = function (roomName) {
  const observer = this.structures.observer.find(
    (observer) => Game.map.getRoomLinearDistance(observer.room.name, roomName) <= 10
  )
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

Overlord.manageConstructionSites = function () {
  const constructionSites = Game.constructionSites

  this.heap.constructionSites = this.heap.constructionSites || {}

  for (const id in this.heap.constructionSites) {
    const constructionSite = Game.getObjectById(id)
    if (!constructionSite) {
      delete this.heap.constructionSites[id]
      continue
    }

    const info = this.heap.constructionSites[id]

    const progress = info.progress

    const currentProgress = constructionSite.progress

    if (currentProgress <= progress) {
      if (constructionSite.room && constructionSite.room.isMy) {
        continue
      }
      constructionSite.remove()
      delete this.heap.constructionSites[id]
      continue
    }
  }

  for (const id in constructionSites) {
    const constructionSite = constructionSites[id]
    this.heap.constructionSites[id] = { progress: constructionSite.progress }
  }
}

Overlord.getAllRemoteNames = function () {
  if (Game._allRemoteNames) {
    return Game._allRemoteNames
  }

  const result = []
  for (const room of this.myRooms) {
    const remoteNames = Object.keys(room.memory.remotes || {})
    result.push(...remoteNames)
  }

  return (Game._allRemoteNames = result)
}

Object.defineProperties(Creep.prototype, {
  assignedRoom: {
    get() {
      if (this.memory.assignedRoom) {
        return this.memory.assignedRoom
      }
      const splitedName = this.name.split(' ')
      return splitedName[0]
    },
  },
  originalRole: {
    get() {
      const splitedName = this.name.split(' ')
      return splitedName[1]
    },
  },
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
  },
}

Overlord.memHack.register()

profiler.registerObject(Overlord, 'Overlord')

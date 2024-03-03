require('allies')
require('constants')

require('overlord')

require('global_function')

require('creep_prototype_attacker')
require('creep_prototype_blinky')
require('creep_prototype_combat')
require('creep_prototype_hauler')
require('creep_prototype_powerCreep')
require('creep_prototype_remote')
require('creep_prototype_researcher')
require('creep_prototype')

const creepAction = require('creepAction')
const { config } = require('./config')

require('dashboard')
require('data')

require('flag_clearAll')
require('flag_dismantleRoom')
require('flag_harass')
require('flag_intersharding')
require('flag_lootRoom')
require('flag_prototype')
require('flag_reconstruction')
require('flag_war')

require('grafana_stats')

require('market_business')

require('overlord_manage_bucket')
require('overlord_manage_claim')
require('overlord_manage_diplomacy')
require('overlord_manage_resources')
require('overlord_metric')
require('overlord_tasks_blinky')
require('overlord_tasks_claim')
require('overlord_tasks_deposit')
require('overlord_tasks_duo')
require('overlord_tasks_guard')
require('overlord_tasks_harass')
require('overlord_tasks_mineral')
require('overlord_tasks_occupy')
require('overlord_tasks_powerBank')
require('overlord_tasks_quad')
require('overlord_tasks_siege')
require('overlord_tasks_singleton')
require('overlord_tasks_transport')
require('overlord_tasks')

require('quad_prototype')

require('room_manager_base')
require('room_manager_defense')
require('room_manager_defenseNuke')
require('room_manager_energy')
require('room_manager_factory')
require('room_manager_lab_boost')
require('room_manager_lab_reaction')
require('room_manager_powerSpawn')
require('room_manager_remote')
require('room_manager_scout')
require('room_manager_spawn')
require('room_manager_tower')
require('room_manager_traffic')
require('room_manager_work')
require('room_manager')

require('room_prototype')

require('roomPosition_prototype')
require('roomVisual_prototype')

require('source_prototype')
require('structure_prototype')
require('terminal_prototype')

require('util_base_planner')
require('util_chunking')
require('util_combat_analysis')
require('util_defenseCostMatrix')
require('util_dijkstra')
require('util_distance_transform')
require('util_flood_fill')
require('util_heap')
require('util_min-cut')
require('util_roomPosition')
require('util')

// Any modules that you use that modify the game's prototypes should be require'd
// before you require the profiler.
const profiler = require('screeps-profiler')

// This line monkey patches the global prototypes.
if (Memory.profile) {
  profiler.enable()
  profiler.registerObject(Business, 'Business')
  profiler.registerObject(Overlord, 'Overlord')
}

delete Memory.globalReset

function wrapLoop(fn) {
  let memory
  let tick

  return () => {
    if (tick && tick + 1 === Game.time && memory) {
      // this line is required to disable the default Memory deserialization
      delete global.Memory
      Memory = memory
    } else {
      memory = Memory
    }

    tick = Game.time

    fn()

    // there are two ways of saving Memory with different advantages and disadvantages
    // 1. RawMemory.set(JSON.stringify(Memory));
    // + ability to use custom serialization method
    // - you have to pay for serialization
    // - unable to edit Memory via Memory watcher or console
    // 2. RawMemory._parsed = Memory;
    // - undocumented functionality, could get removed at any time
    // + the server will take care of serialization, it doesn't cost any CPU on your site
    // + maintain full functionality including Memory watcher and console

    // this implementation uses the official way of saving Memory
    RawMemory._parsed = Memory
  }
}

module.exports.loop = wrapLoop(function () {
  profiler.wrap(function () {
    // hasRespawned
    if (hasRespawned()) {
      RawMemory.set('{}')
      for (const key in Memory) {
        delete Memory[key]
      }
      global.Heap = {
        rooms: new Map(),
        creeps: new Map(),
        sources: new Map(),
        quads: new Map(),
        overlord: {},
      }
      console.log('respawn')
    }

    // autoClaim
    if (Math.random() < 0.01) {
      try {
        Overlord.manageAutoClaim()
      } catch (err) {
        data.recordError(err, 'autoclaim')
      }
    }

    if (Memory.globalReset === undefined) {
      console.log(`Global reset happens at ${Game.time}`)
      Memory.globalReset = Game.time
    }

    // Overlord 동작
    try {
      Overlord.classifyCreeps()
    } catch (err) {
      data.recordError(err, 'classifyCreeps')
    }

    // flag 실행
    for (const flag of Object.values(Game.flags)) {
      try {
        const name = flag.name.toLowerCase()
        const roomName = flag.pos.roomName
        if (name.includes('claim')) {
          claim(roomName)
          flag.remove()
          continue
        }
        if (name.includes('clear')) {
          flag.manageClearAll()
          continue
        }
        if (name.includes('reconstruction')) {
          flag.manageReconstruction()
          continue
        }
        if (name.includes('loot')) {
          flag.lootRoom()
          continue
        }
        if (name.includes('send')) {
          flag.sendIntershardingCreeps()
          continue
        }
        if (name.includes('intershard')) {
          flag.claimIntershard()
          continue
        }
        if (name.includes('analyze')) {
          Overlord.observeRoom(flag.pos.roomName)
          if (flag.room) {
            flag.room.optimizeBasePlan()
          }
          continue
        }
        if (name.includes('baseplan')) {
          Overlord.observeRoom(flag.pos.roomName)
          if (flag.room) {
            flag.room.getBasePlanByPos(flag.pos)
          }
          continue
        }
        if (name.includes('war')) {
          flag.conductWar()
          continue
        }
        if (name.includes('nuke')) {
          flag.nukeRoom()
          flag.remove()
          continue
        }
        if (name.includes('dismantle')) {
          flag.dismantleRoom()
          continue
        }
        if (name.includes('observe')) {
          Overlord.observeRoom(flag.pos.roomName)
          continue
        }
      } catch (err) {
        data.recordError(err, flag.name)
      }
    }

    Overlord.runTasks()

    if (Game.cpu.bucket < 100 || Game.cpu.getUsed() > 500) {
      return
    }

    // 방마다 roomManager 동작
    for (const room of Object.values(Game.rooms)) {
      try {
        room.runRoomManager()
      } catch (err) {
        data.recordError(err, room.name)
      }
    }

    // independent creeps 동작

    for (const creep of Overlord.classifyCreeps().independents) {
      try {
        const role = creep.memory.role
        if (creepAction[role]) {
          creepAction[role](creep)
        }
      } catch (err) {
        data.recordError(err, creep.name)
      }
    }

    // 방마다 traffic manager 동작
    for (const room of Object.values(Game.rooms)) {
      try {
        room.manageTraffic()
      } catch (err) {
        data.recordError(err, room.name)
      }
    }

    // 없어진 flag 메모리 삭제
    if (Memory.flags) {
      Object.keys(Memory.flags).forEach(
        //메모리에 있는 flag 이름마다 검사
        function (flag) {
          if (!Game.flags[flag]) {
            //해당 이름을 가진 flag가 존재하지 않으면
            delete Memory.flags[flag] //메모리를 지운다
          }
        }
      )
    }

    // 완료된 order 및 안보이는 방 memory 삭제 및 c.site 삭제
    if (Game.time % 300 === 0) {
      //죽은 크립 메모리 삭제
      if (Object.keys(Memory.creeps).length > Object.keys(Game.creeps).length) {
        Object.keys(Memory.creeps).forEach(
          //메모리에 있는 크립이름마다 검사
          function (creep) {
            if (!Game.creeps[creep]) {
              //해당 이름을 가진 크립이 존재하지 않으면
              delete Memory.creeps[creep] //메모리를 지운다
            }
          }
        )
      }

      const finishedOrders = Object.values(Game.market.orders).filter((order) => order.active === false)
      for (const order of finishedOrders) {
        Game.market.cancelOrder(order.id)
      }

      try {
        Overlord.manageConstructionSites()
      } catch (err) {
        data.recordError(err, 'manageConstructionSites')
      }
    }

    if (data.observe) {
      Overlord.observeRoom(data.observe.roomName, data.observe.tick)
    }

    const terminal = Overlord.structures.terminal.sort()[data.terminalOrder]
    data.terminalOrder = (data.terminalOrder + 1) % Overlord.structures.terminal.length
    if (terminal && (!Memory.abandon || !Memory.abandon.includes(terminal.room.name))) {
      try {
        terminal.run()
      } catch (err) {
        data.recordError(err, terminal.room.name)
      }
    }

    if (Math.random() < 0.01 && config.buyPixel && config.creditGoal && Game.market.credits > config.creditGoal) {
      Business.buy('pixel', 500)
    }

    try {
      Overlord.manageBucket()
      Overlord.visualizeRoomInfo()
      Overlord.mapInfo()
      Overlord.exportStats()
      Overlord.manageDiplomacy()
    } catch (err) {
      data.recordError(err, 'overlord')
    }
  })
})

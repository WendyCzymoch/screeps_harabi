require('allies')
require('constants')

require('overlord')

require('creep_prototype_attacker')
require('creep_prototype_blinky')
require('creep_prototype_combat')
require('creep_prototype_harass')
require('creep_prototype_hauler')
require('creep_prototype_powerCreep')
require('creep_prototype_researcher')
require('creep_prototype')

const creepAction = require('creepAction')
const { config } = require("./config")

require('dashboard')
require('data')

require('flag_claim')
require('flag_clearAll')
require('flag_dismantleRoom')
require('flag_harass')
require('flag_intersharding')
require('flag_lootRoom')
require('flag_prototype')
require('flag_reconstruction')
require('flag_war')

require('global_function')

require('grafana_stats')

require('market_business')

require('overlord_harass')
require('overlord_manage_resources')
require('overlord_metric')
require('overlord_tasks_blinky')
require('overlord_tasks_deposit')
require('overlord_tasks_duo')
require('overlord_tasks_guard')
require('overlord_tasks_quad')
require('overlord_tasks_occupy')
require('overlord_tasks_powerBank')
require('overlord_tasks_siege')
require('overlord_tasks_singleton')
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
require('room_manager_SK_mining')
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
require('util')

// Any modules that you use that modify the game's prototypes should be require'd
// before you require the profiler.
const profiler = require('screeps-profiler');

// This line monkey patches the global prototypes.
profiler.enable();

delete Memory.globalReset

module.exports.loop = () => {
    Overlord.memHack.pretick()

    profiler.wrap(function () {
        if (hasRespawned()) {
            RawMemory.set('{}');
            for (const key in Memory) {
                delete Memory[key]
            }
            global.Heap = {
                rooms: new Map(),
                creeps: new Map(),
                sources: new Map(),
                quads: new Map(),
                overlord: {}
            }
            console.log('respawn')
        }

        // bucket check. 8000 5000 2000
        if (data.enoughCPU && Game.cpu.bucket < 5000) { // stop market, highwaymining
            data.enoughCPU = false
        } else if (!data.enoughCPU && Game.cpu.bucket > 8000) {
            data.enoughCPU = true
        }

        if (data.okCPU && Game.cpu.bucket < 2000) { // stop lab
            data.okCPU = false
        } else if (!data.okCPU && Game.cpu.bucket > 5000) {
            data.okCPU = true
        }

        if (!data.cpuEmergency && Game.cpu.bucket < 1000) {
            data.cpuEmergency = true
        } else if (data.cpuEmergency && Game.cpu.bucket > 2000) {
            data.cpuEmergency = false
        }

        if (data.isEnoughCredit && Game.market.credits < 10000000) {
            data.isEnoughCredit = false
        } else if (!data.isEnoughCredit && Game.market.credits > 20000000) {
            data.isEnoughCredit = true
        }

        if (Memory.globalReset === undefined) {
            console.log(`Global reset happens at ${Game.time}`)
            Memory.globalReset = Game.time
        }

        // Overlord 동작
        Overlord.classifyCreeps()

        // flag 실행

        for (const flag of Object.values(Game.flags)) {
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
        }

        Overlord.runTasks()

        if (Game.cpu.bucket < 100 || Game.cpu.getUsed() > 500) {
            return
        }

        // 방마다 roomManager 동작
        for (const room of Object.values(Game.rooms)) {
            room.runRoomManager()
        }

        // independent creeps 동작

        for (const creep of Overlord.classifyCreeps().independents) {
            try {
                const role = creep.memory.role
                creepAction[role](creep)
            } catch (error) {
            }
        }

        // powerCreep 실행
        for (const powerCreep of Object.values(Game.powerCreeps)) {
            const roomName = powerCreep.name.split(' ')[0]
            if (!Game.rooms[roomName]) {
                continue
            }
            if (!powerCreep.room) {
                Game.rooms[roomName].memory.hasOperator = false
                const powerSpawn = Game.rooms[roomName].structures.powerSpawn[0]
                if (!powerSpawn) {
                    continue
                }
                powerCreep.spawn(powerSpawn)
                continue
            }
            Game.rooms[roomName].memory.hasOperator = true
            powerCreep.actRoomOperator()
        }

        // 방마다 traffic manager 동작
        for (const room of Object.values(Game.rooms)) {
            room.manageTraffic()
        }

        // 없어진 flag 메모리 삭제
        if (Memory.flags) {
            Object.keys(Memory.flags).forEach( //메모리에 있는 flag 이름마다 검사
                function (flag) {
                    if (!Game.flags[flag]) //해당 이름을 가진 flag가 존재하지 않으면
                    {
                        delete Memory.flags[flag]; //메모리를 지운다
                    }
                }
            )
        }


        // 완료된 order 및 안보이는 방 memory 삭제 및 pixel 구입
        if (Game.time % 300 === 0) {
            //죽은 크립 메모리 삭제
            if (Object.keys(Memory.creeps).length > Object.keys(Game.creeps).length) {
                Object.keys(Memory.creeps).forEach( //메모리에 있는 크립이름마다 검사
                    function (creep) {
                        if (!Game.creeps[creep]) { //해당 이름을 가진 크립이 존재하지 않으면
                            delete Memory.creeps[creep]; //메모리를 지운다
                        }
                    })
            }

            const finishedOrders = Object.values(Game.market.orders).filter(order => order.active === false)
            for (const order of finishedOrders) {
                Game.market.cancelOrder(order.id)
            }
        }

        if (data.observe) {
            Overlord.observeRoom(data.observe.roomName, data.observe.tick)
        }

        const terminal = Overlord.structures.terminal.sort()[data.terminalOrder]
        data.terminalOrder = (data.terminalOrder + 1) % (Overlord.structures.terminal.length)
        if (terminal && (!Memory.abandon || !Memory.abandon.includes(terminal.room.name))) {
            terminal.run()
        }

        if (Math.random() < 0.01 && config.buyPixel && config.creditGoal && Game.market.credits > config.creditGoal) {
            Business.buy('pixel', 500)
        }

        if (data.info) {
            try {
                Overlord.visualizeRoomInfo()
                Overlord.mapInfo()
            } catch (err) {
                console.log(err)
            }
        } else {
            new RoomVisual().text('time: ' + Game.time, 0, 46, { align: 'left' })
            new RoomVisual().text('CPU: ' + Game.cpu.getUsed(), 0, 47, { align: 'left' })
            new RoomVisual().text(`bucket: ${Game.cpu.bucket}(${data.enoughCPU ? 'market, ' : ''}${data.okCPU ? 'lab' : ''})`, 0, 49, { align: 'left' })
        }

        Overlord.exportStats()
    });
}


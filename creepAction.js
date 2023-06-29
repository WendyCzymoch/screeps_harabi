function miner(creep) {
    // 캐러 갈 곳
    const room = creep.room //지금 크립이 있는 방
    const source = Game.getObjectById(creep.memory.sourceId)
    const container = sourceContainer()
    const link = sourceLink(source)

    if (container && !room.lookAt(sourceContainer()).filter(obj => obj.type === LOOK_CREEPS).length) {
        if (creep.pos.getRangeTo(container) > 0) {
            return creep.moveMy(container)
        }
    }

    if (creep.pos.getRangeTo(source) > 1) {
        return creep.moveMy(source, { range: 1 })
    }

    creep.harvest(source)

    if (!creep.store.getCapacity()) {
        return
    }

    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) && container && container.hits < 248000) {
        return creep.repair(container)
    }

    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 40) {
        return creep.transfer(link, RESOURCE_ENERGY)
    }

    if (container && container.store[RESOURCE_ENERGY]) {
        return creep.withdraw(container, RESOURCE_ENERGY)
    }

    function sourceContainer() {
        let _sourceContainer = Game.getObjectById(creep.memory.sourceContainer)
        if (_sourceContainer) {
            return _sourceContainer
        }
        _sourceContainer = source.container
        if (_sourceContainer) {
            creep.memory.sourceContainer = _sourceContainer.id
            return _sourceContainer
        }
        return false
    }

    function sourceLink(source) {
        let _sourceLink = Game.getObjectById(creep.memory.sourceLink)
        if (_sourceLink) {
            return _sourceLink
        }
        _sourceLink = source.link
        if (_sourceLink) {
            creep.memory.sourceLink = _sourceLink.id
            return _sourceLink
        }
        return false
    }
}

function wallMaker(creep) { //스폰을 대입하는 함수 (이름 아님)
    const room = creep.room

    if (creep.ticksToLive < 50) {
        creep.getRecycled()
        return
    }

    if (creep.memory.working && creep.store.getUsedCapacity(RESOURCE_ENERGY) < 1) {
        creep.memory.working = false
    } else if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) < 1) {
        creep.memory.working = true;
        creep.memory.task = target().id
    }

    if (!creep.memory.working) {
        if (room.storage) {
            if (creep.withdraw(room.storage, RESOURCE_ENERGY) === -9) {
                creep.moveMy(room.storage, { range: 1 })
            }
        }
        return
    }
    if (Game.getObjectById(creep.memory.task)) {
        if (creep.repair(Game.getObjectById(creep.memory.task)) === -9) {
            creep.moveMy(Game.getObjectById(creep.memory.task).pos, { range: 3 })
        }
        return
    }
    creep.memory.task = target().id
    return

    function target() {
        if (room.structures.constructedWall.length || room.structures.rampart.length) {
            return room.structures.constructedWall.concat(room.structures.rampart).sort((a, b) => { return a.hits - b.hits })[0]
        }
        return false
    }
}

function extractor(creep) { //스폰을 대입하는 함수 (이름 아님)
    const terminal = Game.getObjectById(creep.memory.terminal)
    const mineral = Game.getObjectById(creep.memory.mineral)
    const extractor = creep.room.structures.extractor[0]
    const container = extractor.pos.findInRange(creep.room.structures.container, 1)[0]
    if (!terminal || !extractor || !container) {
        return
    }

    //행동

    if (!creep.pos.isEqualTo(container.pos)) {
        return creep.moveMy(container.pos)
    }

    if (extractor.cooldown === 0) {
        return creep.harvest(mineral)
    }
}

function reserver(creep) {
    if (!creep.memory.runAway && creep.room.memory.isKiller) {
        creep.memory.runAway = true
    } else if (creep.memory.runAway && Game.rooms[creep.memory.colony] && !Game.rooms[creep.memory.colony].memory.isKiller) {
        creep.memory.runAway = false
    }

    if (creep.memory.runAway) {
        const base = new RoomPosition(25, 25, creep.memory.base)
        if (creep.room.name !== creep.memory.base) {
            creep.moveTo(base)
            return
        }
        if (creep.pos.getRangeTo(base) > 22) {
            creep.moveTo(base, { range: 22, maxRooms: 1 })
            return
        }
        if (creep.pos.lookFor(LOOK_STRUCTURES).length) {
            creep.move(Math.floor(Math.random() * 8) + 1)
        }
        return
    }

    const controller = Game.rooms[creep.memory.colony] ? Game.rooms[creep.memory.colony].controller : false
    if (creep.room.name !== creep.memory.colony) {
        if (controller) {
            creep.moveMy(controller, { range: 1 })
        }
        const target = new RoomPosition(25, 25, creep.memory.colony)
        creep.moveMy(target, { range: 20 })
        return
    }

    if (!controller.sign || controller.sign.username !== creep.owner.username) {
        if (creep.signController(controller, "A creep can do what he wants, but not want what he wants.") === -9) {
            creep.moveMy(controller, { range: 1 })
            return
        }
    }

    if (creep.reserveController(controller) === -9) {
        creep.moveMy(controller, { range: 1 })
    } else if (creep.reserveController(controller) !== OK) {
        creep.attackController(controller)
    } else if (!creep.isWorkable(creep.pos)) {
        const workingSpot = creep.pos.findClosestByRange(creep.getWorkingSpots(controller.pos, 1))
        if (workingSpot) {
            creep.moveMy(workingSpot)
        }
    }
}

function colonyLaborer(creep) {
    const base = new RoomPosition(25, 25, creep.memory.base)
    if (!creep.memory.runAway && creep.room.memory.isKiller) {
        creep.memory.runAway = true
    } else if (creep.memory.runAway && Game.rooms[creep.memory.colony] && !Game.rooms[creep.memory.colony].memory.isKiller) {
        creep.memory.runAway = false
    }

    if (creep.memory.runAway) {
        if (creep.room.name !== creep.memory.base) {
            creep.moveMy(base)
            return
        }
        if (creep.pos.getRangeTo(base) > 20) {
            creep.moveMy(base, { range: 20 })
            return
        }
        if (creep.pos.lookFor(LOOK_STRUCTURES).length) {
            creep.move(Math.floor(Math.random() * 8) + 1)
        }
        return
    }

    // 논리회로
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false
    } else if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        creep.memory.working = true
    }

    // 행동
    if (creep.memory.working) {
        if (!Game.getObjectById(creep.memory.task)) {
            if (creep.room.constructionSites.length) {
                creep.memory.task = creep.pos.findClosestByRange(creep.room.constructionSites).id
            } else {
                creep.memory.task = false
            }
        }

        if (creep.memory.task) {
            const workshop = Game.getObjectById(creep.memory.task)
            if (!workshop) {
                delete creep.memory.task
                return
            }
            if (creep.build(workshop) === -9) {
                creep.moveMy(workshop, { range: 3 })
            }
            return
        }

        if (creep.room.name !== creep.memory.base) {
            creep.moveMy(base, { range: 20 })
            return
        }
        creep.getRecycled()
        return
    }

    const colony = Game.rooms[creep.memory.colony]

    if (colony) {
        const source = Game.getObjectById(creep.memory.sourceId)
        if (creep.harvest(source) === -9) {
            creep.moveMy(source, { range: 1 })
        }
        return
    }

    creep.moveToRoom(creep.memory.colony)
}

function colonyMiner(creep) {
    if (!creep.memory.runAway && creep.room.memory.isKiller) {
        creep.memory.runAway = true
    } else if (creep.memory.runAway && Game.rooms[creep.memory.colony] && !Game.rooms[creep.memory.colony].memory.isKiller) {
        creep.memory.runAway = false
    }

    if (creep.memory.runAway) {
        const base = new RoomPosition(25, 25, creep.memory.base)
        if (creep.room.name !== creep.memory.base) {
            creep.moveTo(base)
            return
        }
        if (creep.pos.getRangeTo(base) > 22) {
            creep.moveTo(base, { range: 22, maxRooms: 1 })
            return
        }
        if (creep.pos.lookFor(LOOK_STRUCTURES).length) {
            creep.move(Math.floor(Math.random() * 8) + 1)
        }
        return
    }

    const source = Game.getObjectById(creep.memory.sourceId)

    if (!source && creep.room.name !== creep.memory.colony) {
        creep.moveToRoom(creep.memory.colony)
        return
    }

    if (!source.container) {
        return false
    }

    if (creep.room.name !== creep.memory.colony || creep.harvest(source) === -9 || creep.pos.getRangeTo(source.container) > 0) {
        creep.moveMy(source.container.pos)
        return
    }

    if (source.container.hits < 200000) {
        creep.repair(source.container)
    }
    creep.room.visual.line(creep.pos, source.container.pos, { color: 'orange' })
}

function colonyHauler(creep) {
    if (!creep.memory.runAway && creep.room.memory.isKiller) {
        creep.memory.runAway = true
    } else if (creep.memory.runAway && Game.rooms[creep.memory.colony] && !Game.rooms[creep.memory.colony].memory.isKiller) {
        creep.memory.runAway = false
    }

    if (creep.memory.runAway) {
        const base = new RoomPosition(25, 25, creep.memory.base)
        if (creep.room.name !== creep.memory.base) {
            creep.moveTo(base)
            return
        }
        if (creep.pos.getRangeTo(base) > 22) {
            creep.moveTo(base, { range: 22, maxRooms: 1 })
            return
        }
        if (creep.pos.lookFor(LOOK_STRUCTURES).length) {
            creep.move(Math.floor(Math.random() * 8) + 1)
        }
        return
    }

    // 논리회로
    if (creep.memory.supplying && creep.store[RESOURCE_ENERGY] === 0) {
        if (creep.room.name === creep.memory.base && creep.ticksToLive < 2.2 * creep.memory.sourcePathLength) {
            creep.getRecycled()
            return
        }
        creep.memory.supplying = false
    } else if (!creep.memory.supplying && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        creep.memory.supplying = true
    }

    // 행동
    if (creep.memory.supplying) {
        const storage = Game.rooms[creep.memory.base].storage
        if (!storage) {
            return
        }

        if (creep.room.name !== creep.memory.base) {
            const closeBrokenThings = creep.pos.findInRange(creep.room.structures.damaged, 3).filter(structure => structure.structureType === STRUCTURE_ROAD)
            if (closeBrokenThings.length) {
                creep.repair(closeBrokenThings[0])
            }
            creep.moveMy(storage.pos, { range: 1 })
            return
        }
        if (creep.pos.getRangeTo(storage) > 1) {
            return creep.moveMy(storage, { range: 1 })
        }
        if (creep.transfer(creep.room.storage, RESOURCE_ENERGY) === OK) {
            creep.room.addColonyProfit(creep.memory.colony, creep.store[RESOURCE_ENERGY])
        }
        return
    }

    const source = Game.getObjectById(creep.memory.sourceId)
    if (!source || !source.container) {
        return
    }

    if (creep.room.name !== creep.memory.colony) {
        creep.moveMy(source.container.pos, { range: 1 })
        return
    }

    if (creep.pos.findInRange(creep.room.find(FIND_DROPPED_RESOURCES), 1).length) {
        if (creep.pickup(creep.pos.findInRange(creep.room.find(FIND_DROPPED_RESOURCES), 1)[0]) === -9) {
            creep.moveMy(source.container.pos, { range: 1 })
        }
        return
    }

    if (creep.pos.getRangeTo(source.container.pos) > 1) {
        creep.moveMy(source.container.pos, { range: 1 })
        return
    }

    if (source.container.store[RESOURCE_ENERGY] >= creep.store.getFreeCapacity(RESOURCE_ENERGY)) {
        creep.withdraw(source.container, RESOURCE_ENERGY)
    }
}

function colonyDefender(creep) {
    if (creep.room.name !== creep.memory.colony) {
        creep.moveToRoom(creep.memory.colony)
        return
    }

    const hostileCreeps = creep.room.find(FIND_HOSTILE_CREEPS)

    const target = creep.pos.findClosestByRange(hostileCreeps)
    const targetCore = creep.pos.findClosestByRange(creep.room.find(FIND_HOSTILE_STRUCTURES))
    if (target) {
        if (creep.pos.getRangeTo(target) > 4) {
            creep.moveMy(target, { range: 3 })
        }
        if (creep.pos.getRangeTo(target < 3)) {
            creep.moveMy(target, { range: 3, flee: true })
        }
        creep.rangedAttack(target)
        return
    }

    if (targetCore) {
        if (creep.attack(targetCore) === -9) {
            creep.moveMy(targetCore, { range: 1 })
        }
        return
    }

    if (creep.pos.getRangeTo(creep.room.controller) > 3) {
        creep.moveMy(creep.room.controller, { range: 3 })
    }
}

function claimer(creep) { //스폰을 대입하는 함수 (이름 아님)
    // 캐러 갈 곳
    if (creep.room.name !== creep.memory.targetRoom && creep.room.find(FIND_FLAGS)[0]) {
        const flag = creep.room.find(FIND_FLAGS)[0]
        if (creep.pos.isEqualTo(flag.pos)) {
            return flag.remove()
        }
        return creep.moveMy(flag.pos)
    }
    if (creep.room.name === creep.memory.targetRoom) {
        const controller = creep.room.controller
        if (controller.reservation) {
            if (creep.attackController(controller) === -9) {
                creep.moveMy(controller, { range: 1 });
            }
        } else if (creep.claimController(controller) === -9) {
            creep.moveMy(controller.pos, { range: 1 });
        }

        if (!controller.sign || controller.sign.username !== creep.owner.username) {
            if (creep.signController(controller, "A creep can do what he wants, but not want what he wants.") === -9) {
                creep.moveMy(controller, { range: 1 })
                return
            }
        }
    } else {
        const controller = Game.rooms[creep.memory.colony] ? Game.rooms[creep.memory.colony].controller : false
        if (controller) {
            creep.moveMy(controller, { range: 1 })
        }
        const target = new RoomPosition(25, 25, creep.memory.targetRoom)
        creep.moveMy(target, { range: 20 })
        return
    }
}

function pioneer(creep) {
    if (creep.room.name === creep.memory.targetRoom) {
        // 논리회로
        if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.working = false
        } else if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
            creep.memory.working = true
        }

        // 행동
        if (creep.memory.working) {
            const spawn = creep.room.structures.spawn[0]
            if (spawn && spawn.store[RESOURCE_ENERGY] < spawn.store.getCapacity(RESOURCE_ENERGY)) {
                return creep.giveEnergyTo(spawn.id)
            }

            if (!Game.getObjectById(creep.memory.task)) {
                if (creep.room.constructionSites.length) {
                    creep.memory.task = creep.room.constructionSites.sort((a, b) => { return BUILD_PRIORITY[a.structureType] - BUILD_PRIORITY[b.structureType] })[0].id
                } else {
                    creep.memory.task = false
                }
            }
            if (creep.room.controller.ticksToDowngrade > 1000 && creep.memory.task) {
                const workshop = Game.getObjectById(creep.memory.task)
                if (creep.build(workshop) === -9) {
                    creep.moveMy(workshop, { range: 3 })
                }
            } else {
                if (creep.upgradeController(creep.room.controller) === -9) {
                    creep.moveMy(creep.room.controller, { range: 3 })
                }
            }
        } else {
            const remainStructures = creep.room.find(FIND_STRUCTURES).filter(structure => !structure.my && structure.store && structure.store[RESOURCE_ENERGY] > 300)
            remainStructures.push(...creep.room.find(FIND_RUINS).filter(ruin => ruin.store[RESOURCE_ENERGY] > 0))
            if (remainStructures.length) {
                creep.memory.withdrawFrom = creep.pos.findClosestByRange(remainStructures).id
                if (creep.withdraw(Game.getObjectById(creep.memory.withdrawFrom), RESOURCE_ENERGY) === -9) {
                    creep.moveMy(Game.getObjectById(creep.memory.withdrawFrom), { range: 1 })
                }
            } else {
                if (creep.harvest(creep.room.sources[(creep.memory.number || 0) % 2]) === -9) {
                    creep.moveMy(creep.room.sources[(creep.memory.number || 0) % 2], { range: 1 })
                }
            }
        }
    } else {
        if (creep.room.name !== creep.memory.targetRoom && creep.room.find(FIND_FLAGS).length) {
            const flag = creep.room.find(FIND_FLAGS)[0]
            if (creep.pos.isEqualTo(flag.pos)) {
                return flag.remove()
            }
            return creep.moveMy(flag.pos)

        }
        const target = new RoomPosition(25, 25, creep.memory.targetRoom)
        return creep.moveMy(target, { range: 20 });
    }
}

function researcher(creep) {
    creep.delivery()
}

module.exports = { miner, extractor, reserver, claimer, pioneer, colonyLaborer, colonyMiner, colonyHauler, colonyDefender, wallMaker, researcher }
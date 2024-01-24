const { config } = require("./config")

function miner(creep) {
    // 캐러 갈 곳
    const source = Game.getObjectById(creep.memory.sourceId)
    const container = source.container
    const link = source.link

    if (container && !creep.pos.isEqualTo(container.pos)) {
        if (!container.pos.creep || container.pos.creep.memory.role !== creep.memory.role) {
            return creep.moveMy(source.container)
        }
    }

    if (creep.pos.getRangeTo(source) > 1) {
        const targetPos = source.pos.getAtRange(1).find(pos => pos.walkable && (!pos.creep || (pos.creep.my && pos.creep.memory.role !== creep.memory.role)))
        if (!targetPos) {
            creep.moveMy({ pos: source.pos, range: 3 })
            return
        }
        return creep.moveMy({ pos: targetPos, range: 0 })
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
}

function wallMaker(creep) { //스폰을 대입하는 함수 (이름 아님)
    const room = creep.room

    if (creep.ticksToLive < 20) {
        creep.getRecycled()
        return
    }

    if (creep.memory.working && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
        delete creep.memory.targetId
        creep.memory.working = false
    } else if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        creep.memory.working = true;
    }

    if (!creep.memory.working) {
        if (room.storage) {
            if (creep.pos.getRangeTo(room.storage) > 1) {
                creep.moveMy({ pos: room.storage.pos, range: 1 })
                return
            }
            creep.withdraw(room.storage, RESOURCE_ENERGY)
        } else {
            creep.heap.deliveryCallTime = Game.time
        }
        return
    }

    let target = Game.getObjectById(creep.memory.targetId)
    if (target) {
        creep.setWorkingInfo(target.pos, 3)
    }

    if (!target || !target.structureType || target.structureType !== 'rampart') {
        target = creep.room.weakestRampart
        if (target) {
            creep.memory.targetId = target.id
        }
    }

    if (creep.pos.getRangeTo(target) > 3) {
        creep.moveMy({ pos: target.pos, range: 3 })
        return
    }

    target = getMinObject(creep.pos.findInRange(creep.room.structures.rampart, 3), rampart => rampart.hits)

    creep.repair(target)
}

function extractor(creep) { //스폰을 대입하는 함수 (이름 아님)
    const terminal = Game.getObjectById(creep.memory.terminal)
    const mineral = Game.getObjectById(creep.memory.mineral)
    const extractor = creep.room.structures.extractor[0]
    if (!extractor) {
        this.getRecycled()
        return
    }
    const container = extractor.pos.findInRange(creep.room.structures.container, 1)[0]
    if (!terminal || !container) {
        data.recordLog(`FAIL: ${creep.name} can't harvest mineral`, creep.room.name)
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

function colonyDefender(creep) {

    if (creep.memory.boosted === false && !Overlord.remotes.includes(creep.memory.colony)) {
        delete creep.memory.boosted
        delete creep.memory.wait
    }

    creep.activeHeal()

    creep.harasserRangedAttack()

    if (!creep.memory.flee && (creep.hits / creep.hitsMax) <= 0.7) {
        creep.memory.flee = true
    } else if (creep.memory.flee && (creep.hits / creep.hitsMax) === 1) {
        creep.memory.flee = false
    }

    const hostileCreeps = creep.room.findHostileCreeps()
    const killerCreeps = hostileCreeps.filter(creep => creep.checkBodyParts(['attack', 'ranged_attack', 'heal']))

    if (killerCreeps.length > 0) {
        // remember when was the last time that enemy combatant detected
        creep.heap.enemyLastDetectionTick = Game.time

        if (creep.handleCombatants(killerCreeps) !== ERR_NO_PATH) {
            return
        }
    }

    if (creep.room.name !== creep.memory.colony) {
        if (creep.memory.waitForTroops) {
            return
        }

        if (creep.memory.flee) {
            const enemyCombatants = creep.room.getEnemyCombatants()
            for (const enemy of enemyCombatants) {
                if (creep.pos.getRangeTo(enemy.pos) < 10) {
                    creep.say('😨', true)
                    creep.fleeFrom(enemy, 15, 2)
                    return
                }
            }
            const center = new RoomPosition(25, 25, creep.room.name)
            if (creep.pos.getRangeTo(center) > 20) {
                creep.moveMy({ pos: center, range: 20 })
            }
            return
        }

        creep.moveToRoom(creep.memory.colony, 2)
        return
    }

    const closestHostileCreep = creep.pos.findClosestByPath(hostileCreeps)

    if (closestHostileCreep) {
        creep.heap.enemyLastDetectionTick = Game.time
        const range = creep.pos.getRangeTo(closestHostileCreep)
        if (range > 1) {
            creep.moveMy({ pos: closestHostileCreep.pos, range: 1 }, { staySafe: false, ignoreMap: 1 })
        }
        return
    }

    if (creep.heap.enemyLastDetectionTick !== undefined && Game.time < creep.heap.enemyLastDetectionTick + 5) {
        return
    }

    const wounded = creep.room.find(FIND_MY_CREEPS).filter(creep => creep.hitsMax - creep.hits > 0)
    if (wounded.length) {
        const target = creep.pos.findClosestByRange(wounded)
        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveMy({ pos: target.pos, range: 1 }, { staySafe: false, ignoreMap: 1 })
        }
        creep.heal(target)
        return
    }

    if (creep.room.isMy) {
        creep.setWorkingInfo(creep.room.controller.pos, 5)
        creep.moveMy({ pos: creep.room.controller.pos, range: 5 }, { staySafe: false, ignoreMap: 1 })
        return
    }

    const constructionSites = creep.room.find(FIND_CONSTRUCTION_SITES).filter(constructionSite => !constructionSite.my && !constructionSite.pos.isWall && constructionSite.progress > 0)
    const closestConstructionSite = creep.pos.findClosestByPath(constructionSites)
    if (closestConstructionSite) {
        if (closestConstructionSite.pos.isRampart) {
            return creep.moveMy({ pos: closestConstructionSite.pos, range: 1 })
        }
        return creep.moveMy(closestConstructionSite)
    }

    const intel = Overlord.getIntel(creep.room.name)
    const isEnemyRemote = (intel[scoutKeys.reservationOwner] && !intel[scoutKeys.isAllyRemote] && !Overlord.remotes.includes(creep.room.name))

    const structuresToWreck = isEnemyRemote
        ? creep.room.find(FIND_STRUCTURES)
        : creep.room.find(FIND_HOSTILE_STRUCTURES)

    const hostileStructure = creep.pos.findClosestByPath(structuresToWreck.filter(structure => {
        const structureType = structure.structureType
        if (structureType === 'controller') {
            return false
        }
        if (structureType === 'powerBank') {
            return false
        }
        return true
    }))
    if (hostileStructure) {
        if (creep.pos.getRangeTo(hostileStructure) > 1) {
            creep.moveMy({ pos: hostileStructure.pos, range: 1 }, { staySafe: false, ignoreMap: 1 })
            return
        }
        creep.rangedAttack(hostileStructure)
        return
    }

    if (creep.room.constructionSites.length > 0) {
        const constructionSite = creep.room.constructionSites[0]
        creep.moveMy({ pos: constructionSite.pos, range: 5 })
        creep.setWorkingInfo(constructionSite.pos, 5)
        return
    }

    if (creep.pos.x < 3 || creep.pos.x > 46 || creep.pos.y < 3 || creep.pos.y > 46) {
        const center = new RoomPosition(25, 25, creep.memory.colony)
        creep.setWorkingInfo(center, 20)
        creep.moveMy({ pos: center, range: 20 }, { staySafe: false, ignoreMap: 1 })
    }
}

function claimer(creep) { //스폰을 대입하는 함수 (이름 아님)
    const hostileCreeps = creep.room.getEnemyCombatants()

    if (creep.pos.findInRange(hostileCreeps, 5).length > 0) {
        creep.fleeFrom(hostileCreeps, 15)
        return
    }

    if (creep.room.name !== creep.memory.targetRoom) {

        const flag = creep.room.find(FIND_FLAGS)[0]
        if (flag) {
            if (creep.pos.isEqualTo(flag.pos)) {
                return flag.remove()
            }
            return creep.moveMy(flag.pos)
        }

        const controller = Game.rooms[creep.memory.targetRoom] ? Game.rooms[creep.memory.targetRoom].controller : false
        if (controller) {
            return creep.moveMy({ pos: controller.pos, range: 1 })
        }
        creep.moveToRoom(creep.memory.targetRoom, 2)
        return
    }

    const controller = creep.room.controller

    if (!controller) {
        return
    }

    // approach
    if (creep.pos.getRangeTo(controller.pos) > 1) {
        return creep.moveMy({ pos: controller.pos, range: 1 });
    }

    // if reserved, attack controller
    if (controller.reservation && controller.reservation.username !== MY_NAME) {
        return creep.attackController(controller)
    }

    // if owned, attack controller
    if (controller.owner && controller.owner.username !== MY_NAME && !controller.upgradeBlocked) {
        return creep.attackController(controller)
    }

    // claim
    if (!controller.owner) {
        creep.claimController(controller)
        return
    }

    // sign
    if (!controller.sign || controller.sign.username !== MY_NAME) {
        creep.signController(controller, "A creep can do what he wants, but not want what he wants.")
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

            if (!Game.getObjectById(creep.memory.targetId)) {
                if (creep.room.constructionSites.length) {
                    creep.memory.targetId = creep.room.constructionSites.sort((a, b) => { return BUILD_PRIORITY[a.structureType] - BUILD_PRIORITY[b.structureType] })[0].id
                } else {
                    creep.memory.targetId = false
                }
            }
            if (creep.room.controller.ticksToDowngrade > 1000 && creep.memory.targetId) {
                const workshop = Game.getObjectById(creep.memory.targetId)
                if (creep.build(workshop) === -9) {
                    return creep.moveMy({ pos: workshop.pos, range: 3 })
                }
            } else {
                if (creep.upgradeController(creep.room.controller) === -9) {
                    return creep.moveMy({ pos: creep.room.controller.pos, range: 3 })
                }
            }
        } else {
            const remainStructures = creep.room.find(FIND_HOSTILE_STRUCTURES).filter(structure => structure.store && structure.store[RESOURCE_ENERGY] > 100)
            remainStructures.push(...creep.room.find(FIND_RUINS).filter(ruin => ruin.store[RESOURCE_ENERGY] > 0))
            if (remainStructures.length) {
                creep.memory.withdrawFrom = creep.pos.findClosestByRange(remainStructures).id
                if (creep.withdraw(Game.getObjectById(creep.memory.withdrawFrom), RESOURCE_ENERGY) === -9) {
                    return creep.moveMy({ pos: Game.getObjectById(creep.memory.withdrawFrom).pos, range: 1 })
                }
            }
            const droppedEnergies = creep.room.find(FIND_DROPPED_RESOURCES).filter(resource => resource.resourceType === 'energy')
            const closestDroppedEnergy = creep.pos.findClosestByRange(droppedEnergies)
            if (creep.pos.getRangeTo(closestDroppedEnergy) <= 3) {
                if (creep.pos.getRangeTo(closestDroppedEnergy) > 1) {
                    return creep.moveMy({ pos: closestDroppedEnergy.pos, range: 1 })
                }
                return creep.pickup(closestDroppedEnergy)
            }
            const sources = creep.room.sources
            if (sources.length === 0) {
                return
            }
            const source = sources[(creep.memory.number || 0) % sources.length]
            if (creep.pos.getRangeTo(source) > 1) {
                return creep.moveMy({ pos: source.pos, range: 1 })
            }
            creep.setWorkingInfo(source.pos, 1)
            return creep.harvest(source)
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
        return creep.moveMy({ pos: target, range: 20 });
    }
}

function guard(creep) {
    if (creep.memory.targetRoomName) {
        return
    }
    if (config.harass && !creep.memory.harass && creep.ticksToLive < 500) {
        creep.memory.harass = true
    }
    if (creep.memory.harass) {
        if (creep.harass() === OK) {
            return
        } else {
            creep.memory.harass = false
        }
    }
    creep.harasserRangedAttack()
    creep.moveToRoom(creep.memory.base, 2)
}

function researcher(creep) {
    creep.delivery()
}

module.exports = { miner, extractor, claimer, pioneer, colonyDefender, wallMaker, researcher, guard }
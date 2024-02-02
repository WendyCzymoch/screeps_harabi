Room.prototype.manageWork = function () {
    // 위협이 있으면 일단 막자
    if (this.memory.militaryThreat && this.isWalledUp) {
        return this.manageReinforce()
    }

    // downgrade가 너무 임박한 상태면 일단 upgrade부터
    if (!this.heap.upgradeFirst && this.controller.ticksToDowngrade < 5000) {
        this.heap.upgradeFirst = true
    } else if (this.heap.upgradeFirst && this.controller.ticksToDowngrade >= 10000) {
        this.heap.upgradeFirst = false
    }

    // 건설할 곳이 있고 downgrade가 급하지 않으면 build부터
    if (this.constructionSites.length > 0 && !this.heap.upgradeFirst) {
        this.heap.constructing = true
        return this.manageBuild()
    } else {
        this.heap.constructing = false
    }

    // 아니면 upgrade부터
    return this.manageUpgrade()
}

Room.prototype.manageReinforce = function () {
    const REPAIR_RANGE = 4
    const rampartAnchorsStatus = this.getRampartAnchorsStatus()
    for (const laborer of this.creeps.laborer) {
        const status = rampartAnchorsStatus[laborer.memory.assign]
        if (!status) {
            continue
        }
        const target = status.closestIntruder
        if (!target) {
            continue
        }

        laborer.needDelivery = true
        if (!laborer.working) {
            //storage가 가까우면 storage에서 energy 받자
            if (this.storage) {
                laborer.getEnergyFrom(this.storage.id)
                continue
            }
        }

        // 한번 repair 시작하면 10 tick 동안은 그거 수리하자
        const rampartBefore = Game.getObjectById(laborer.memory.rampartLowestId)
        if (rampartBefore && laborer.memory.rampartLowestTime && (Game.time - laborer.memory.rampartLowestTime) < 10) {
            laborer.repairMy(rampartBefore)
            continue
        }


        let rampartsInRange = this.structures.rampart.filter(rampart => rampart.pos.getRangeTo(target) <= REPAIR_RANGE)
        if (rampartsInRange.length === 0) {
            rampartsInRange = this.structures.rampart.filter(rampart => rampart.pos.getRangeTo(status.pos) <= REPAIR_RANGE)
        }
        const rampartLowest = rampartsInRange.sort((a, b) => a.hits - b.hits)[0]
        if (!rampartLowest) {
            continue
        }
        laborer.memory.rampartLowestId = rampartLowest.id
        laborer.memory.rampartLowestTime = Game.time
        laborer.repairMy(rampartLowest)
    }
}

Room.prototype.manageBuild = function () {
    // laborer 찾기
    let laborers = Overlord.getCreepsByRole(this.name, 'laborer')

    // construction site 목록 작성
    let constructionSites = this.constructionSites
    if (constructionSites.length && laborers.length) {
        // 업무 배치 시작
        const targetsByPriority = {}

        for (const constructionSite of constructionSites) {
            if (OBSTACLE_OBJECT_TYPES.includes(constructionSite.structureType)) {
                const creepOnConstructionSite = constructionSite.pos.creep
                if (creepOnConstructionSite) {
                    creepOnConstructionSite.moveRandom()
                }
            }

            const priority = BUILD_PRIORITY[constructionSite.structureType]

            targetsByPriority[priority] = targetsByPriority[priority] || []
            targetsByPriority[priority].push(constructionSite)
        }

        const priorityMin = Math.min(...Object.keys(targetsByPriority).map(key => Number(key)))
        const priorityTargets = targetsByPriority[priorityMin]
        for (const laborer of laborers) {
            if (laborer.room.name !== this.name) {
                continue
            }
            if (laborer.memory.targetId !== undefined) {
                continue
            }
            laborer.memory.targetId = laborer.pos.findClosestByRange(priorityTargets).id
        }
    }

    for (const laborer of laborers) {
        laborer.needDelivery = true
        // energy 없으면 energy 받아라
        if (!laborer.working) {
            const energySource = this.storage || this.terminal
            if (energySource) {
                laborer.getEnergyFrom(energySource.id)
            }
            continue
        }
        // energy 있으면 일해라
        laborer.buildTarget()
    }

}

Room.prototype.manageUpgrade = function () {
    // laborer 동작 및 이용가능한 laborer 찾기
    let laborers = this.creeps.laborer
    const controllerLink = this.controller.linked ? this.controller.link : undefined
    if (controllerLink) {
        this.visual.text(` 🔋${controllerLink.store[RESOURCE_ENERGY]}/800`,
            controllerLink.pos.x + 0.5, controllerLink.pos.y,
            { font: 0.5, align: 'left' }
        )
    }

    const container = this.controller.container
    if (container) {
        this.visual.text(` 🔋${container.store[RESOURCE_ENERGY]}/2000`,
            container.pos.x + 0.5, container.pos.y,
            { font: 0.5, align: 'left' }
        )
    }

    const tombstones = this.controller.pos.findInRange(FIND_TOMBSTONES, 3).filter(tombstone => tombstone.store[RESOURCE_ENERGY] > 0)
    const droppedEnergies = this.controller.pos.findInRange(FIND_DROPPED_RESOURCES, 3).filter(droppedResource => droppedResource.resourceType === RESOURCE_ENERGY)
    const droppedEnergy = droppedEnergies[0]

    for (const laborer of laborers) {
        if (laborer.memory.boosted === false && laborer.ticksToLive > 0.8 * CREEP_LIFE_TIME) { // boost 예약이 안되어있으면 undefined. boost 되었으면 true
            continue
        }
        if (!laborer.working) {
            if (tombstones.length) {
                laborer.getEnergyFrom(tombstones[0].id)
                continue
            }
            if (droppedEnergy && droppedEnergy.amount > 100) {
                laborer.getEnergyFrom(droppedEnergy.id)
                continue
            }
            if (controllerLink) {
                if (controllerLink.store[RESOURCE_ENERGY] > 0) {
                    laborer.getEnergyFrom(controllerLink.id)
                }
                continue
            }
            if (container) {
                if (container.store[RESOURCE_ENERGY] > 0) {
                    laborer.getEnergyFrom(container.id)
                    continue
                } else if (laborer.pos.getRangeTo(container) >= 2) {
                    laborer.moveMy({ pos: container.pos, range: 2 })
                    continue
                }
            }
            laborer.needDelivery = true
        }

        if (container && container.store[RESOURCE_ENERGY] > 0 && (laborer.pos.getRangeTo(container) <= 1 || (laborer.store[RESOURCE_ENERGY] / laborer.store.getCapacity()) <= 0.3)) {
            laborer.getEnergyFrom(container.id)
        }

        if (controllerLink && controllerLink.store[RESOURCE_ENERGY] > 0 && (laborer.pos.getRangeTo(controllerLink) <= 1 || (laborer.store[RESOURCE_ENERGY] / laborer.store.getCapacity()) <= 0.3)) {
            laborer.getEnergyFrom(controllerLink.id)
        }

        laborer.upgradeRCL()
    }
}

Object.defineProperties(Creep.prototype, {
    working: {
        get() {
            if (this.memory.working && this.store[RESOURCE_ENERGY] === 0) {
                this.memory.working = false
            } else if (!this.memory.working && this.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                this.memory.working = true;
            }
            return this.memory.working
        }
    }
})

Object.defineProperties(RoomPosition.prototype, {
    workingSpot: {
        get() {
            if (!this._workingSpot) {
                const candidatePositions = this.getInRange(3).filter(pos => !this.isEqualTo(pos))
                this._workingSpot = candidatePositions.filter(pos => pos.workable)
            }
            return this._workingSpot
        }
    },
    isRoad: {
        get() {
            const road = this.lookFor(LOOK_STRUCTURES).find(structure => structure.structureType === STRUCTURE_ROAD)
            if (road !== undefined) {
                return true
            }
            return false
        }
    },
    creep: {
        // don't cache this like this._creep since roomPosition Object can be stored at heap.
        get() {
            const creeps = this.lookFor(LOOK_CREEPS)
            const powerCreeps = this.lookFor(LOOK_POWER_CREEPS)
            return creeps[0] || powerCreeps[0]
        }
    }
})

Creep.prototype.isWorkable = function (pos) {
    if (!pos.workable) {
        return false
    }
    if (pos.creep && pos.creep.id !== this.id) {
        return false
    }
    return true
}

Creep.prototype.getWorkingSpots = function (pos, range = 3) {
    return pos.getInRange(range).filter(pos => this.isWorkable(pos))
}

Room.prototype.packPos = function (pos) {
    return 50 * pos.y + pos.x
}

Creep.prototype.repairMy = function (target) {
    const costs = this.room.memory.militaryThreat ? this.room.defenseCostMatrix : this.room.basicCostmatrix
    if (costs.get(this.pos.x, this.pos.y) >= DANGER_TILE_COST) {
        this.heap.run = 3
    } else {
        delete this.heap.run
    }

    if (this.heap.run > 0) {
        const spawn = this.room.structures.spawn[0]
        this.heap.run--
        if (spawn && costs.get(this.pos.x, this.pos.y) >= DANGER_TILE_COST) {
            return this.moveMy({ pos: spawn.pos, range: 1 })
        }
    }

    if (this.pos.getRangeTo(target) > 3) {
        this.moveMy({ pos: target.pos, range: 3 })
        return
    }

    this.setWorkingInfo(target.pos, 3)
    this.repair(target)
}

Creep.prototype.upgradeRCL = function () {
    const controller = this.room.controller
    if (!controller) {
        console.log(`${this.room.name} has weird laborer`)
        return
    }
    if (!controller.sign || controller.sign.username !== this.owner.username) {
        if (this.pos.getRangeTo(controller.pos) > 1) {
            this.moveMy({ pos: controller.pos, range: 1 })
            return
        }
        this.signController(controller, "A creep can do what he wants, but not want what he wants.")
    }

    if (this.pos.getRangeTo(controller) > 3) {
        this.moveMy({ pos: controller.pos, range: 3 })
        return
    }
    this.setWorkingInfo(controller.pos, 3)
    this.upgradeController(controller)
}

Creep.prototype.buildTarget = function () {
    const constructionSite = Game.getObjectById(this.memory.targetId)

    if (!constructionSite) {
        delete this.memory.targetId
        return
    }

    if (this.pos.getRangeTo(constructionSite) > 3) {
        this.moveMy({ pos: constructionSite.pos, range: 3 })
        return
    }
    if (this.pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0) {
        this.moveRandom()
    }
    this.setWorkingInfo(constructionSite.pos, 3)
    this.build(constructionSite)
}
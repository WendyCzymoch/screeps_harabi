Room.prototype.manageConstruction = function () {
    if (!this.memory.level || Game.time % 5000 === 0) { // 5000 tick은 대략 7~8시간?
        this.memory.level = this.controller.level - 1
    }

    if (this.controller.level < this.memory.level) {
        this.memory.level = 0
        return
    }

    if (this.controller.level === this.memory.level) {
        return
    }

    this.GRCL

    if (this.memory.doOptimizeBasePlan) {
        if (this.optimizeBasePlan() === OK) {
            delete this.memory.doOptimizeBasePlan
        }
        return
    }

    if (Math.random() < 0.1 && this.constructByBasePlan(this.memory.level + 1)) {
        this.memory.level++
    }
}

Room.prototype.constructByBasePlan = function (level) {
    const basePlan = this.basePlan
    if (!basePlan) {
        if (Game.cpu.bucket < 2000) {
            return false
        }
        const spawn = this.structures.spawn[0]
        if (!spawn) {
            this.memory.doOptimizeBasePlan = true
            return false
        }
        console.log(`${this.name} get base plan by spawn`)
        if (this.getBasePlanBySpawn() !== OK) {
            console.log('fail')
            return false
        }
    }
    let numConstructionSites = Object.keys(Game.constructionSites).length
    let newConstructionSites = 0
    let numConstructionSitesThisRoom = this.constructionSites.length

    if (this.controller.level < 5) { // rcl 5 이전에는 controller container
        if (this.controller.level > 1) {
            const linkPos = this.parsePos(this.memory.basePlan.linkPositions.controller)
            linkPos.createConstructionSite('container')
        }
    } else {
        const controllerContainer = this.controller.container
        if (controllerContainer) {
            controllerContainer.destroy()
        }
    }

    const structures = []
    for (let i = 1; i <= level; i++) {
        structures.push(...basePlan[`lv${i}`])
    }

    structures.sort((a, b) => BUILD_PRIORITY[a.structureType] - BUILD_PRIORITY[b.structureType])

    for (const structure of structures) {
        if (numConstructionSitesThisRoom >= 5) {
            return false
        }
        if (structure.structureType === 'spawn') {
            if (structure.pos.createConstructionSite(structure.structureType, `${this.name} Spawn ${structure.pos.pack()}`) === OK) {
                numConstructionSites++
                newConstructionSites++
                numConstructionSitesThisRoom++
            }
            continue
        }
        if (SHARD === 'swc') {
            if (structure.structureType === 'powerSpawn') {
                continue
            }
            if (structure.structureType === 'nuker') {
                continue
            }
        }

        if (structure.pos.createConstructionSite(structure.structureType) === OK) {
            numConstructionSites++
            newConstructionSites++
            numConstructionSitesThisRoom++
        }
    }


    if (newConstructionSites === 0 && numConstructionSitesThisRoom === 0 && numConstructionSites < 90) {
        return true
    }
    return false
}
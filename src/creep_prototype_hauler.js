Object.defineProperties(Creep.prototype, {
  supplying: {
    get() {
      if (this.memory.supplying && this.store.getUsedCapacity() <= 0) {
        this.memory.supplying = false;
      }
      if (!this.memory.supplying && this.store.getFreeCapacity() <= 0) {
        this.memory.supplying = true;
      }
      return this.memory.supplying;
    },
  },
});

Creep.prototype.getResourceFrom = function (target, options = {}) {
  const { resourceType, amount } = options;

  if (!target) {
    return ERR_INVALID_TARGET;
  }

  if (this.pos.getRangeTo(target) > 1) {
    this.moveMy({ pos: target.pos, range: 1 });
    return ERR_NOT_IN_RANGE;
  }

  if (target instanceof Resource) {
    if (resourceType) {
      if (target.resourceType === resourceType) {
        return this.pickup(target);
      }
      return ERR_NOT_ENOUGH_RESOURCES;
    }
    return this.pickup(target);
  }

  if (!target.store) {
    return ERR_INVALID_TARGET;
  }

  if (resourceType) {
    if (target.store[resourceType] > 0) {
      return this.withdraw(target, resourceType, amount);
    }
    return ERR_NOT_ENOUGH_RESOURCES;
  }

  for (const resourceType in target.store) {
    if (target.store[resourceType] > 0) {
      return this.withdraw(target, resourceType);
    }
  }
  return ERR_NOT_ENOUGH_RESOURCES;
};

Creep.prototype.giveResourceTo = function (target, options = {}) {
  const { resourceType, amount } = options;

  if (!target) {
    return ERR_INVALID_TARGET;
  }

  if (this.pos.getRangeTo(target) > 1) {
    this.moveMy({ pos: target.pos, range: 1 });
    return ERR_NOT_IN_RANGE;
  }

  if (resourceType) {
    return this.transfer(target, resourceType, amount);
  }

  for (const resourceType in this.store) {
    return this.transfer(target, resourceType);
  }

  return ERR_NOT_ENOUGH_RESOURCES;
};

Creep.prototype.getEnergyFrom = function (id) {
  const target = Game.getObjectById(id);
  if (!target || (!target.amount && !(target.store && target.store[RESOURCE_ENERGY]))) {
    return ERR_INVALID_TARGET;
  }
  if (this.pos.getRangeTo(target) > 1) {
    this.moveMy({ pos: target.pos, range: 1 });
    return ERR_NOT_IN_RANGE;
  }
  this.setWorkingInfo(target.pos, 1);
  if (this.withdraw(target, RESOURCE_ENERGY) === OK) {
    return OK;
  }
  return this.pickup(target);
};

Creep.prototype.giveEnergyTo = function (id) {
  const target = Game.getObjectById(id);
  if (!target) {
    return ERR_INVALID_TARGET;
  }

  if (this.pos.getRangeTo(target) > 1) {
    this.moveMy({ pos: target.pos, range: 1 });
    return ERR_NOT_IN_RANGE;
  }

  return this.transfer(target, RESOURCE_ENERGY);
};

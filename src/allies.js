const { config } = require('./config');

global.allies = config.allies;

Room.prototype.findHostileCreeps = function () {
    if (this._hostileCreeps !== undefined) {
        return this._hostileCreeps;
    }
    const hostileCreeps = this.find(FIND_HOSTILE_CREEPS);
    const hostileCreepsFiltered = hostileCreeps.filter((creep) => {
        return !creep.isAlly();
    });
    return (this._hostileCreeps = hostileCreepsFiltered);
};

Creep.prototype.isAlly = function () {
    return allies.includes(this.owner.username);
};

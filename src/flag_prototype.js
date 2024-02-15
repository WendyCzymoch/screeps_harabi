/**
 * find closest my room
 * @param {number} level - RCL threshold
 * @returns
 */
Flag.prototype.findClosestMyRoom = function (level = 0) {
    if (this.memory.closestRoom) {
        return Game.rooms[this.memory.closestRoom];
    }
    const closestRoomName = Object.keys(Game.rooms)
        .filter(
            (roomName) =>
                roomName !== this.pos.roomName &&
                Game.rooms[roomName].isMy &&
                Game.rooms[roomName].controller.level >= level
        )
        .sort((a, b) => {
            return (
                (Game.map.findRoute(this.pos.roomName, a).length || Infinity) -
                (Game.map.findRoute(this.pos.roomName, b).length || Infinity)
            );
        })[0];
    this.memory.closestRoom = closestRoomName;
    return Game.rooms[closestRoomName];
};

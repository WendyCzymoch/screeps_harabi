const checkIntent = function (fn) {
  return function () {
    Game._intent = Game._intent || 0;
    if (fn.apply(this, arguments) === OK) {
      Game._intent++;
    }
  };
};

Creep.prototype.moveAndCheckIntent = checkIntent(Creep.prototype.move);

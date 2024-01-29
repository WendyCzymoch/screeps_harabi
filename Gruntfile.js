module.exports = function (grunt) {
  const config = require('./.screeps.json')
  const branch = grunt.option('branch') || config.branch;
  const email = grunt.option('email') || config.email;
  const ptr = grunt.option('ptr') ? true : config.ptr
  const token = grunt.option('token') ? true : config.token
  const password = grunt.option('password') ? true : config.password

  grunt.loadNpmTasks('grunt-screeps');

  grunt.initConfig({
    screeps: {
      options: {
        email: email,
        token: token,
        branch: branch,
        ptr: ptr,
        // server: 'season'
      },
      dist: {
        src: ['src/*.js']
      },

      mmo: {
        options: {
          server: 'persistent',
          email: email,
          token: token,
          branch: branch,
          ptr: ptr,
        },
        src: ['src/*.js']
      },

      season: {
        options: {
          branch: branch,
          server: 'season',
          email: email,
          token: token,
        },
        src: ['src/*.js']
      },
    },
  });

  grunt.registerTask('default', ['screeps:mmo'])
  grunt.registerTask('all', ['screeps:mmo', 'screeps:season'])
  grunt.registerTask('season', ['screeps:season'])
}
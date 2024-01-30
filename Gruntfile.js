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
        password: password,
        ptr: ptr,
        // server: 'season'
      },
      dist: {
        src: ['src/*.js']
      },

      mmo: {
        options: {
          server: 'persistent',
        },
        src: ['src/*.js']
      },

      season: {
        options: {
          server: 'season',
        },
        src: ['src/*.js']
      },

      private: {
        options: {
          token: undefined,
          server: {
            host: '127.0.0.1',
            port: 21025,
            http: true
          },
        },
        src: ['src/*.js']
      }
    },
  });

  grunt.registerTask('default', ['screeps:mmo'])
  grunt.registerTask('all', ['screeps:mmo', 'screeps:season', 'screeps:private'])
  grunt.registerTask('season', ['screeps:season'])
  grunt.registerTask('private', ['screeps:private'])
}
module.exports = function (grunt) {
  const config = require('./.screeps.json')
  const branch = grunt.option('branch') || config.branch;
  const email = grunt.option('email') || config.email;
  const ptr = grunt.option('ptr') ? true : config.ptr
  const token = grunt.option('token') ? true : config.token

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
      }
    }
  });

  grunt.registerTask('default', ['screeps'])
}
module.exports = function(grunt) {
  grunt.initConfig({
    browserify:{
      production:{
        files:{
          'dist/openvv.js':['src/OpenVV.js']
        },
        options:{
          transform:['babelify'],
          browserifyOptions:{
            debug:true,
            standalone:'OpenVV'
          }
        }
      }
    }
  });

  grunt.loadNpmTasks('grunt-browserify');
  grunt.registerTask('default',['browserify:production']);
  grunt.registerTask('development',['browserify:development']);
  grunt.registerTask('test',[]);
}
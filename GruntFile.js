module.exports = function(grunt) {
  grunt.initConfig({
    browserify:{
      production:{
        files:{
          'dist/openvv.js':['src/OpenVV.js']
        },
        options:{
          transform: ['babelify'],
          browserifyOptions:{
            debug:true,
            standalone:'OpenVV'
          }
        }
      },
      demo: {
        files: {
          'demo/vpaid/vpaid-client.js': ['src/Demo/VPAID/vpaid-client.js']
        },
        options: {
          transform: ['babelify']
        }
      }
    }
  });

  grunt.loadNpmTasks('grunt-browserify');
  
  grunt.registerTask('default',     ['browserify:production']);
  grunt.registerTask('buildDemo',   ['browserify:demo']);
  grunt.registerTask('development', ['browserify:development']);
  grunt.registerTask('test',        []);
}
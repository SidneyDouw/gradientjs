module.exports = {
	paths: {
		src: {
			index: 	'src/index.*',
			js: 	'src/js/**/*.js',
			jsMain: 'src/js/main.js'
		},
		dest: {
			root: 	'dist/',
			js: 	'dist/'
		}
	},
	rjs: {
		paths: {
			almond: '../../../../bower_components/almond/almond'
		},
		include: ['almond', 'main'],
		out: 'gradient.js',
		wrap: {
			start: "(function(root,factory){if(typeof define==='function'&&define.amd){define([],factory)}else{root.Gradient=factory()}}(this,function(){",
			end: "return require('main')}))"
		},
		optimize: "none"
	}
};
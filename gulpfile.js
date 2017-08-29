var gulp 	= require('gulp');
var plugins = require('gulp-load-plugins')({pattern: ['*']});
var config 	= require('./gulp-config.js');

function getTask(task) {
    return require('../../tasks/gulp_' + task).bind(null, gulp, plugins, config);
}

gulp.task('plugins', function() {
	console.log(plugins)
});

gulp.task('clear', getTask('clear'))

gulp.task('index', getTask('index'));
gulp.task('js', getTask('rjs'));

gulp.task('browserSync', getTask('browserSync'));

gulp.task('build', ['clear', 'index', 'js']);

gulp.task('default', ['build', 'browserSync'], function() {

	gulp.watch(config.paths.src.index, ['index']);
	gulp.watch(config.paths.src.js, ['js']);

});
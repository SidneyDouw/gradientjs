require(['Gradient'], function(Gradient) {

	var myDiv1 = document.getElementById('testDiv1');
	var myDiv2 = document.getElementById('testDiv2');

	var gradient1 = new Gradient(myDiv1, 4);
	var gradient2 = new Gradient(myDiv2, 4);

	return Gradient;

});
define(['jscolor'], function(jsc) {

	var jscolor = jsc.jscolor;

	function ColorStop(gradient, position, color, size) {

		this.position = position;
		this.color = color;
		
		this.size = size;

		this.domWidth = parseFloat(window.getComputedStyle(gradient.domElement).getPropertyValue('width'));
		this.domHeight = parseFloat(window.getComputedStyle(gradient.domElement).getPropertyValue('height'));

		this.width = this.domHeight/(10-this.size);
		this.height = this.domHeight + this.domHeight*0.5;

		this.addDomElement(gradient);

	}

	ColorStop.prototype.addDomElement = function(gradient) {

		var _this = this;

		var x = this.domWidth * this.position;
		if (x < 0) x = 0;
		if (x > this.domWidth-this.width) x = this.domWidth - this.width;

		this.square = document.createElement('div');
		this.square.style.position = 'absolute';
		this.square.style.left = x + 'px'; 
		this.square.style.bottom = -1 - this.domHeight*0.25 + 'px';
		this.square.style.width = this.width + 'px';
		this.square.style.height = this.height + 'px';
		this.square.style.borderRadius = 20 + 'px';
		this.square.style.background = this.colorToString();
		this.square.style.border = '1px solid #111';
		this.square.style.cursor = 'pointer';

		this.cp = document.createElement('input');
		this.cp.className = 'jscolor {position: "top", backgroundColor: "rgba(38, 38, 38, 0.75)", padding: 10}';
		this.cp.value = this.colorToString();
		this.cp.style.width = 0;
		this.cp.style.height = 0;
		this.cp.style.margin = 0;
		this.cp.style.padding = 0;
		this.cp.style.border = 'None';

		this.square.ondblclick = function(evt) {
		 	this.children[0].jscolor.show();
		 	this.children[0].jscolor.onFineChange = function() {
		 		_this.color = [Math.round(this.rgb[0]), Math.round(this.rgb[1]), Math.round(this.rgb[2]), 1];
		 		_this.square.style.background = _this.colorToString();
				gradient.calculateGradient();
				gradient.onChange.apply(gradient);
		 	};
		};
		this.square.onmouseover = function(evt) {
			_this.hover = true;
			gradient.hover = true;
		};
		this.square.onmousedown = function(evt) {
			_this.drag = true;
		};
		gradient.domElement.addEventListener('mousemove', function(evt) {
			if (_this.drag) {
				var x = evt.clientX - gradient.domElement.getBoundingClientRect().left - _this.width/2;
				if (x < 0) x = 0;
				if (x > _this.domWidth-_this.width) x = _this.domWidth - _this.width;
				_this.square.style.left = x +'px';
				_this.position = x/(_this.domWidth -  _this.width);
				gradient.calculateGradient();
				gradient.onChange.apply(gradient);
			}
		});
		window.addEventListener('mouseup', function(evt) {
			_this.drag = false;
		});
		this.square.onmouseout = function(evt) {
			_this.hover = false;
			gradient.hover = false;
		};

		this.square.append(this.cp);
		// this.square.append(this.triangle);
		gradient.domElement.append(this.square);

		jsc.register();
	};
	ColorStop.prototype.colorToString = function() {
		return 'rgba('+this.color[0]+', '+this.color[1]+', '+this.color[2]+', '+this.color[3]+')';
	};

	return ColorStop;

});
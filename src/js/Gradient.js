define(['colorStop'], function(ColorStop) {

	function Gradient(domElement, size) {

		this.onChange = function() {}

		var _this = this

		this.domElement = domElement;

		this.colorStops = [];

		this.colorStopSize = size;

		this.createInitialColorStops();
		this.calculateGradient();

		this.domElement.onclick = function(evt) {
			if (!_this.hover) {
				var x = (evt.clientX - this.getBoundingClientRect().left) / this.clientWidth;
				_this.addColorStop(x, _this.getColor(x))
			}
		}
		this.domElement.oncontextmenu = function(evt) {
			if (_this.hover) {
				var cs;
				for (var i = 0; i < _this.colorStops.length; i++) {
					cs = _this.colorStops[i];
					if (cs.hover) {
						break
					}
				}
				if (_this.colorStops.length > 1) {
					_this.removeColorStop(evt.toElement, cs)
					_this.hover = false;
				}
			}
			return false;
		}

	}

	Gradient.prototype.createInitialColorStops = function() {
		
		this.addColorStop(0, [255, 0, 0, 1]);
		this.addColorStop(1, [172, 0, 0, 1]);

	};
	Gradient.prototype.addColorStop = function(position, color) {
		var newCS = new ColorStop(this, position, color, this.colorStopSize);

		this.colorStops.push(newCS);

	};
	Gradient.prototype.removeColorStop = function(div, cs) {
		this.domElement.removeChild(div);

		var i = this.colorStops.indexOf(cs);
		this.colorStops.splice(i, 1);

		this.calculateGradient()
	};
	Gradient.prototype.calculateGradient = function() {
		
		this.colorStops.sort(function(a,b){
			return a.position - b.position;
		});
		
		var str = '';
		var j;
		for (j = 0; j < this.colorStops.length; j++) {
			var c = this.colorStops[j];
			str += ', ' + c.colorToString() + ' ' + Math.round(c.position*10000)/100 + '%';
		}
		if (j > 1) {
			this.domElement.style.background = 'linear-gradient(to right' + str + ')';
		} else {
			str = this.colorStops[0].colorToString();
			this.domElement.style.background = str;
		}

	};
	Gradient.prototype.getColor = function(position) {
		if (this.colorStops.length > 1) {
			for (var i = 1; i < this.colorStops.length; i++) {
				var k = this.colorStops[i];
				if (position <= k.position && position >= this.colorStops[i-1].position) {
					var percent = position * (1/k.position);
					return this.getColorFormula(k.color, this.colorStops[i-1].color, percent);
				}
			}
			if (position < this.colorStops[0].position) {
				return this.colorStops[0].color;
			}
			if (position > this.colorStops[this.colorStops.length-1].position) {
				return this.colorStops[this.colorStops.length-1].color;
			}
		} else {
			return this.colorStops[0].color;
		}
	};
	Gradient.prototype.getColorFormula = function(color1, color2, weight) {
		
		var p = weight;
	    var w = p * 2 - 1;
	    var w1 = (w/1+1) / 2;
	    var w2 = 1 - w1;
	    var color = [
	    		Math.round(color1[0] * w1 + color2[0] * w2),
	      		Math.round(color1[1] * w1 + color2[1] * w2),
	       		Math.round(color1[2] * w1 + color2[2] * w2),
	       		1
	       	];

	    return color;

	};
	Gradient.prototype.colorToString = function() {
		this.colorStops.sort(function(a,b){
			return a.position - b.position;
		});
		
		var str = '';
		var j;
		for (j = 0; j < this.colorStops.length; j++) {
			var c = this.colorStops[j];
			str += ', ' + c.colorToString() + ' ' + Math.round(c.position*10000)/100 + '%';
		}
		if (j > 1) {
			return 'linear-gradient(to right' + str + ')';
		} else {
			str = this.colorStops[0].colorToString();
			return str;
		}
	}

	return Gradient;

}) ;
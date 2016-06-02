$(document).ready(function() {
	new Simulation(".kanban-board");
});

function Simulation(hookSelector) {
	this.hourLengthInSeconds = 1;
	this.ticksPerHour = 12;
	this.time;
	this.taskCounter;
	this.timeoutHandler;
	this.gui = new GUI(hookSelector, this, new Cache());
	this.board;
	this.stats;
	this.team;
	this.maxTasksOnOnePerson = 2;
	this.maxPeopleOnOneTask = 2;
	
	this.initBasics = function() {
		this.time = 0;
		this.taskCounter = 1;
		this.team = new Team();
		this.board = new Board(this.ticksPerHour, this);
		this.stats = new Stats();
		this.gui.update(this.board, this.stats, true);
		this.gui.getHeadcount().forEach(function (newHeadcount) {
			this.team.updateHeadcount(newHeadcount[0], newHeadcount[1]);
		}.bind(this));
		this.team.allowedToWorkIn = this.gui.getColumnsAvailability();
	}
	this.initBasics();

	this.play = function() {
		if (!this.timeoutHandler)
			this.timeoutHandler = setTimeout(this.tick.bind(this), this.hourLengthInSeconds * 1000 / this.ticksPerHour);
	}
	
	this.stop = function() {
		clearTimeout(this.timeoutHandler);
		this.timeoutHandler = null;
		this.initBasics()
	}
	
	this.pause = function() {
		this.gui.update(this.board, this.stats, true);
		clearTimeout(this.timeoutHandler);
		this.timeoutHandler = null;
	}

	this.tick = function() {
		this.timeoutHandler = null;
		this.board.updateColumnsLimitsFrom(this.gui);
		this.addNewTasks(this.board);
		this.doWork();
		this.moveTasks(this.board.columns);
		this.assignTeamMembersToTasks();
		this.stats.recalculateStats(this.board, this.time);
		this.removeDoneTasks();
		this.gui.update(this.board, this.stats);
		this.play();
		this.time += 60/this.ticksPerHour;
	}
	
	this.temporalTaskStrategies = {
		"scrum": function(createTaskFunction) {
			if (this.time / (60 * 8) % 10 == 0) {
				for (var i = 0; i < 55; i++) {
					this.board.addTask(createTaskFunction(this.taskCounter++, this.time));
				}
			}
		}.bind(this), 
		"demand-equals-throughput": function(createTaskFunction) {
			if (this.board.columns[0].tasks.length == 0)
				this.board.addTask(createTaskFunction(this.taskCounter++, this.time));
		}.bind(this)};
	this.temporalTaskStrategy = "demand-equals-throughput";
	
	this.temporalTaskStrategyChanged = function(newStrategy) {
		this.temporalTaskStrategy = newStrategy;
	}

	this.addNewTasks = function() {
		var stableFlow = function() {
			if (this.time % 120 == 0 || this.time % 180 == 0) {
				this.board.addTask(new Task(this.taskCounter++, this.time));
			}
		}.bind(this);
		var stableRandomFlow = function() {
			if (this.time % 60 == 0 && Math.random() < 0.7) {
				this.board.addTask(new Task(this.taskCounter++, this.time));
			}
		}.bind(this);
		var alwaysOne = function(taskCreationStrategy) {
			taskCreationStrategy = taskCreationStrategy || createSimpleTask;
			if (this.board.columns[0].tasks.length == 0)
				this.board.addTask(taskCreationStrategy(this.taskCounter++, this.time));
			
		}.bind(this);
		var alwaysOneNormalDistribution = function() {
			return alwaysOne(createNormallyDistributedTask);
		}
		
		var createSimpleTask = function(id, time) {
			return new Task(id, time, 2, 7, 4, 1);
		}
		var createNormallyDistributedTask = function(id, time) {
			return new Task(id, time, normal_random(2, 2), normal_random(7, 4), normal_random(4, 3), normal_random(1, 2));
		}
		function normal_random(mean, variance) {
		  if (mean == undefined)
		    mean = 0.0;
		  if (variance == undefined)
		    variance = 1.0;
		  var V1, V2, S, X;
		  do {
			  do {
			    var U1 = Math.random();
			    var U2 = Math.random();
			    V1 = 2 * U1 - 1;
			    V2 = 2 * U2 - 1;
			    S = V1 * V1 + V2 * V2;
			  } while (S > 1);
			  X = Math.sqrt(-2 * Math.log(S) / S) * V1;
			  X = mean + Math.sqrt(variance) * X;
		  } while (X <= 0);
		  return X;
		}
		//stableFlow();
		//stableRandomFlow();
		//scrumStrategy();
		//alwaysOne();
		//alwaysOneNormalDistribution();
		this.temporalTaskStrategies[this.temporalTaskStrategy](createNormallyDistributedTask);
	}

	this.moveTasks = function(columns) {
		var changed = true;
		while (changed) {
			changed = false;
			columns.forEach(function(column) {
				column.tasks.forEach(function(task) {
					if (task.finished()) {
						var nextColumn = this.findNextColumn(task, columns);
						if (nextColumn != column) {
							changed = true;
							column.moveTaskTo(task, nextColumn);
						}
					}
				}.bind(this));
			}.bind(this));
		}
	}
	
	this.removeDoneTasks = function() {
		if (this.time % (60 * 8) == 0) this.board.removeDoneTasks();
	}

	this.findNextColumn = function(task, columns) {
		var column = task.column;
		var index = columns.indexOf(column);
		while (column && task.finished(column) && (!columns[index + 1] || columns[index + 1].availableSpace(task))) {
			column = columns[++index];
		}
		if (!column) {
			// move to done just before removing from the board
			column = columns[columns.length - 1];
		}
		return column;
	}
		/*
		1. Najpierw szukamy zadan do pracy exlusive w kolumnie specjalizacji (zaczynajac od prawej)
		2. Jesli zostaly zadania do pracy w tej kolumnie, szukamy osob nie pracujacych z innymi nad innym zadaniem w kolumnie, wybierajac tych z najmniejsza liczba zadan w toku
		3. Jesli zostali ludzie do pracy w specjalizacji, probojemy ich dodawac do juz pracujacych, wybierajac zadania z najmniejsza liczba ludzi
		4. Jesli zostali ludzie do pracy, bierzemy sie za nastepna specjalizacje i powtarzamy kroki
		5. Po przejsciu wszystkich kolumn, jesli zostali ludzie do pracy (ktorzy nie pracuja nad zadnym zadaniem), probojemy dopasowac ich do innych kolumn zgodnie z pow. algorytmem
		*/
	this.assignTeamMembersToTasks = function() {
		var columns = this.board.columns;
		for (var columnIndex = columns.length - 1; columnIndex>=0; columnIndex--) {
			var column = columns[columnIndex];
			if (column.isQueue()) {
				continue;
			}
			this.assignTeamMembersToTasksBySpecialisation(column, column.name);
		}
		for (var columnIndex = columns.length - 1; columnIndex>=0; columnIndex--) {
			var column = columns[columnIndex];
			if (column.isQueue()) {
				continue;
			}
			this.assignTeamMembersToTasksBySpecialisation(column);
		}
	}
	
	this.assignTeamMembersToTasksBySpecialisation = function(column, specialisation) {
		var notWorkingPpl = this.team.getNotWorking(column, specialisation);
		var tasksWithNoAssignee = column.getNotAssignedTasks();
		var i;
		for (i=0; i<notWorkingPpl.length && i<tasksWithNoAssignee.length; i++) {
			notWorkingPpl[i].assignTo(tasksWithNoAssignee[i]);
		}
		var stoppedAtIndex = i;
		if (stoppedAtIndex < tasksWithNoAssignee.length) {
			var workingPpl = this.team.getSpecialistsWorkingInColumnOrderedByTaskCount(column, specialisation);
			var j = 0;
			for (; i < tasksWithNoAssignee.length && workingPpl.length > 0 &&workingPpl[j].tasksWorkingOn.length < this.maxTasksOnOnePerson; i++) {
				workingPpl[j].assignTo(tasksWithNoAssignee[i]);
				if (workingPpl[j].tasksWorkingOn.length > workingPpl[(j + 1) % workingPpl.length].tasksWorkingOn.length) {
					j = (j + 1) % workingPpl.length;
				} else {
					j = 0;
				}
			}
		} 
		if (stoppedAtIndex < notWorkingPpl.length) {
			i = stoppedAtIndex;
			var peopleWithMoreTasks = this.team.getPeopleAssignedToMoreThanOneTaskOrderderByTaskCountAndSpecialisation(column);
			var j=0;
			for (; i< notWorkingPpl.length && j < peopleWithMoreTasks.length; i++) {
				var person = peopleWithMoreTasks[j];
				var task = person.tasksWorkingOn[0];
				task.unassignPeople();
				notWorkingPpl[i].assignTo(task);
				if (!peopleWithMoreTasks[j + 1] || person.tasksWorkingOn.length < peopleWithMoreTasks[j + 1].tasksWorkingOn.length || person.tasksWorkingOn.length == 1) {
					j++;
				}
			}
			stoppedAtIndex = i;
		}
		if (stoppedAtIndex < notWorkingPpl.length) {
			i = stoppedAtIndex;
			var tasks = column.getTasksAssignedToOneOrMoreOrderedByNumberOfPeople();
			var j=0;
			for (; i< notWorkingPpl.length && tasks.length > 0 && tasks[j].peopleAssigned.length < this.maxPeopleOnOneTask; i++) {
				notWorkingPpl[i].assignTo(tasks[j]);
				if (tasks[j].peopleAssigned.length > tasks[(j + 1) % tasks.length].peopleAssigned.length) {
					j = (j + 1) % tasks.length;
				} else {
					j = 0;
				}
			}
		}
	}

	this.doWork = function() {	
		this.team.doWork(this.ticksPerHour);
	}
	
	this.updateColumnsAvailabilityForSpecialisation = function(specialisation, column, checked) {
		this.team.updateColumnsAvailabilityForSpecialisation(specialisation, column, checked);
	}
	
	this.updateHeadcount = function(specialisation, newHeadcount) {
		this.team.updateHeadcount(specialisation, newHeadcount);
	}
}

function Team() {
	this.members = [];
	this.removedButWorking = [];
	this.allowedToWorkIn = {
		'analysis': ['analysis'],
		'development': ['development'],
		'qa': ['qa'],
		'deployment': ['deployment']
	};
	
	this.doWork = function(ticksPerHour) {
		this.members.forEach(function(person) {
			person.work(ticksPerHour);
		});
		this.removedButWorking = this.removedButWorking.filter(function (person) {
			return person.tasksWorkingOn.length != 0;
		})
		this.removedButWorking.forEach(function(person) {
			person.work(ticksPerHour);
		});
	}
	
	this.getNotWorking = function(column, specialisation) {
		var result = [];
		this.members.forEach(function(person) {
			if (person.tasksWorkingOn.length == 0 && (!specialisation || person.specialisation == specialisation) && person.isAllowedToWorkIn(column.name)) {
				result.push(person);
			}
		});
		return result;
	}
	
	this.getSpecialistsWorkingInColumnOrderedByTaskCount = function(column, specialisation) {
		var result = [];
		column.tasks.forEach(function(task) {
			if (task.peopleAssigned.length == 1 && (!specialisation || task.peopleAssigned[0].specialisation == specialisation)) {
				var person = task.peopleAssigned[0];
				if (result.indexOf(person) == -1 && person.isAllowedToWorkIn(column.name) && !person.markedAsRemoved) {
					result.push(person);
				}
			}
		});
		result.sort(function(a, b) {
			return a.tasksWorkingOn.length > b.tasksWorkingOn.length;
		});
		return result;
	}
	
	this.getPeopleAssignedToMoreThanOneTaskOrderderByTaskCountAndSpecialisation = function(column) {
		var result = [];
		column.tasks.forEach(function(task) {
			var person = task.peopleAssigned[0];
			if (task.peopleAssigned.length == 1 && person.tasksWorkingOn.length > 1) {
				if (result.indexOf(person) == -1) {
					result.push(person);
				}
			}	
		});
		result.sort(function(personA, personB) { //TODO: to be tested!
			if (personA.specialisation == personB.specialisation) {
				return personA.tasksWorkingOn.length < personB.tasksWorkingOn.length;
			}
			if (personA.specialisation == column.name) {
				return true;
			}
			if (personB.specialisation == column.name) {
				return false;
			}
			return personA.tasksWorkingOn.length < personB.tasksWorkingOn.length;
		});
		return result;
	}
	
	this.updateColumnsAvailabilityForSpecialisation = function(specialisation, column, allowFlag) {
		var collumnsAllowedToWorkIn = this.allowedToWorkIn[specialisation];
		if (allowFlag) {
			collumnsAllowedToWorkIn.push(column);
		} else {
			collumnsAllowedToWorkIn.splice(collumnsAllowedToWorkIn.indexOf(column), 1);
		}
	}
	
	this.updateHeadcount = function(specialisation, newHeadcount) {
		var specialists = this.members.filter(function (person) {
			return person.specialisation == specialisation;
		});
		if (specialists.length < newHeadcount) {
			for (var i = 0; i < newHeadcount - specialists.length; i++) {
				this.members.push(new Person(specialisation, this));
			}
		} else if (specialists.length > newHeadcount) {
			for (var i = 0; i < specialists.length - newHeadcount; i++) {
				this.members.splice(this.members.indexOf(specialists[i]), 1);
				if (specialists[i].tasksWorkingOn.length > 0) {
					this.removedButWorking.push(specialists[i]);
					specialists[i].markedAsRemoved = true;
				}
			}
		}
	}
}

function Person(specialisation, team) {
	this.specialisation = specialisation;
	this.tasksWorkingOn = [];
	this.productivityPerHour = 60;
	this.team = team;
	this.markedAsRemoved = false;
	
	this.assignTo = function(task) {
		this.tasksWorkingOn.push(task);
		task.peopleAssigned.push(this);
	}
	
	this.work = function(ticksPerHour) {
		if (this.tasksWorkingOn.length == 0) return;
		var workPerTask = this.productivityPerHour / this.tasksWorkingOn.length / ticksPerHour;
		this.tasksWorkingOn.forEach(function(task) {
			if (task.column.name != specialisation) {
				task.work(workPerTask / 2);
			} else {
				task.work(workPerTask);
			}
			if (task.finished()) {
				task.unassignPeople();
			}
		});
	}
	
	this.isAllowedToWorkIn = function(columnName) {
		return this.team.allowedToWorkIn[this.specialisation].indexOf(columnName) != -1;
	}
} 

function Board(ticksPerHour, simulation) {
	this.columns = null;
	this.tasks = {};
	this.ticksPerHour = ticksPerHour;
	
	createColumns(this, simulation);
	
	this.lastColumn = function() {
		return this.columns[this.columns.length - 1];
	}
	
	this.addTask = function(task) {
		this.columns[0].addTask(task);
		this.tasks[task.id] = task;
	}
	
	this.removeDoneTasks = function() {
		var lastColumn = this.columns[this.columns.length - 1];
		lastColumn.tasks.forEach(function(task) {
			task.column = null;
			delete this.tasks[task.id];
		}.bind(this));
		lastColumn.tasks = [];
	}
	
	this.getCurrentWip = function() {
		return Object.keys(this.tasks).length - this.getDoneTasksCount();
	}
	
	this.getColumnByName = function(columnName) {
		for (var i = 0; i < this.columns.length; i++) {
			if (this.columns[i].name == columnName) {
				return this.columns[i];
			}
		}
	}
	
	this.getDoneTasksCount = function(start, end) {
		var tasks = this.lastColumn().tasks;
		var colunName = this.lastColumn().name;
		if (!start || !end)
			return tasks.length;
		var count = 0;
		for (var i=0; i < tasks.length; i++) {
			var timeFinished = tasks[i].arrivalTime[colunName];
			if(timeFinished > start && timeFinished <= end) count++;
		}
		return count;
	}
	
	this.updateColumnsLimitsFrom = function(gui) {
		var updateColumnLimit = function(column) {
			if (!column) return;
			column.limit = gui.getLimitForColumn(column.name);
		}

		this.columns.forEach(function(column) {
			updateColumnLimit(column);
			updateColumnLimit(column.parent);
		});

	}
	
	function createColumns(board, simulation) {
		board.columns = [];
		var columns = board.columns;
		columns.push(new Column("input", true, simulation));
		Array.prototype.push.apply(columns, createColumnWithChildren("analysis", simulation).children);
		Array.prototype.push.apply(columns, createColumnWithChildren("development", simulation).children);
		Array.prototype.push.apply(columns, createColumnWithChildren("qa", simulation).children);
		Array.prototype.push.apply(columns, createColumnWithChildren("deployment", simulation).children);
		board.columns[board.columns.length - 1].ignoreLimit = true;
	}

	function createColumnWithChildren(name, simulation) {
		var parentColumn = new Column(name + "WithQueue", false, simulation);
		var column = new Column(name, false, simulation);
		column.parent = parentColumn;
		var done = new Column(name + "Done", true, simulation);
		done.parent = parentColumn;
		parentColumn.children.push(column);
		parentColumn.children.push(done);
		return parentColumn;
	}
}

function Task(taskId, time, analysis, development, qa, deployment) {
	this.id = "Task" + taskId;
	this.created = time;
	this.analysis = analysis*60;
	this.development = development*60;
	this.qa = qa*60;
	this.deployment = deployment*60;
	this.analysisOriginal = this.analysis;
	this.developmentOriginal = this.development;
	this.qaOriginal = this.qa;
	this.deploymentOriginal = this.deployment;
	this.column = null;
	this.peopleAssigned = [];
	this.arrivalTime = {};
	
	this.finished = function (column) {
		if (!column) {
			column = this.column;
		}
		return this[column.name] <= 0 || !this[column.name];
	}
	
	this.work = function(amount) {
		this[this.column.name] -= amount;
	}
	
	this.unassignPeople = function() {
		this.peopleAssigned.forEach(function(person) {
			person.tasksWorkingOn.splice(person.tasksWorkingOn.indexOf(this), 1);
		}.bind(this));
		this.peopleAssigned = [];
	}
}

function Column(name, queue, simulation) {
	this.name = name;
	this.limit = Number.POSITIVE_INFINITY;
	this.tasks = [];
	this.children = [];
	this.parent = null;
	this.ignoreLimit = false;
	this.queue = queue;
	this.simulation = simulation;
	
	this.getTasksAssignedToOneOrMoreOrderedByNumberOfPeople = function() {
		var result = [];
		this.tasks.forEach(function(task) {
			if (task.peopleAssigned.every(function(person) {
				return person.tasksWorkingOn.length == 1;
				})) {
					result.push(task);
				}
		});
		result.sort(function(a, b) {
			return a.peopleAssigned.length > b.peopleAssigned.length;
		});
		return result;
	}
	
	this.getNotAssignedTasks = function() {
		var result = [];
		this.tasks.forEach(function(task) {
			if(task.peopleAssigned.length == 0) {
				result.push(task);
			}
		});
		return result;
	}
	
	this.isQueue = function() {
		return queue;
	}
	
	this.addTask = function(task) {
		this.tasks.push(task);
		task.column = this;
		task.arrivalTime[this.name] = this.simulation.time;
	}
	
	this.moveTaskTo = function(task, nextColumn) {
		this.tasks.splice(this.tasks.indexOf(task), 1);
		task.column = nextColumn;
		if (nextColumn) {
			nextColumn.tasks.push(task);
			task.arrivalTime[nextColumn.name] = this.simulation.time;
		}
	}
	
	this.availableSpace = function(task) {
		if (this.ignoreLimit) return true;
		var limit = this.limit;
		var numberOfTasks = this.tasks.length;
		if (this.children.length > 0) {
			//checking for parent column of task
			var indexOfTasksColumn = this.children.indexOf(task.column);
			if (indexOfTasksColumn < 0) {
				this.children.forEach(function(subColumn) {
					if (!subColumn.ignoreLimit)
						numberOfTasks += subColumn.tasks.length;
				});
			}
		}
		return limit - numberOfTasks > 0 && (!this.parent || this.parent.availableSpace(task));
	}
}

function Stats() {
	this.leadTimes = [];
	this.wipCount = [];
	this.tasksFinished = [];
	this.cfdData = [[],[],[],[],[]]; // [[{time, value},{time, value}][{time, value},{time, value}][]]
	this.dataPointsToRemember = 8  * 20; // hours * days
	this.wipAvg = null;
	this.wipAvgHistory = [];
	this.throughputAvg = null;
	this.throughputAvgHistory = [];
	this.leadTimeAvg = null;
	this.leadTimeAvgHistory = [];
	
	this.getWipAvg = function() {
		this.wipAvg = this.wipAvg || this.wipCount.average();
		return this.wipAvg;
	}
	
	this.getThroughputAvg = function() {
		this.throughputAvg = this.throughputAvg || this.tasksFinished.average() * 8;
		return this.throughputAvg;
	}
	
	this.getLeadTimeAvg = function() {
		this.leadTimeAvg = this.leadTimeAvg ||  ([].concat.apply([], this.leadTimes)).average() / (8 * 60);
		return this.leadTimeAvg;
	}
	
	this.recalculateStats = function(board, time) {
		if (time % 60 != 0) return;
		this.updateCfdData(board, time);
		this.wipAvg = null;
		this.throughputAvg = null;
		this.leadTimeAvg = null;
		var position = (time / 60) % this.dataPointsToRemember;
		var lastColumn = board.lastColumn();
		var leadTimes = [];
		this.leadTimes[position] = leadTimes;
		lastColumn.tasks.forEach(function(task) {
			leadTimes.push(task.arrivalTime[lastColumn.name] - task.created);
		});
		this.tasksFinished[position] = board.getDoneTasksCount(time - 60, time);
		this.wipCount[position] = board.getCurrentWip();
		this.updateHistory(time);
	}
	
	this.updateHistory = function(time) {
		this.wipAvgHistory.push({x: time / 60, y: this.getWipAvg()});
		this.throughputAvgHistory.push({x: time / 60, y: this.getThroughputAvg()});
		this.leadTimeAvgHistory.push({x: time / 60, y: this.getLeadTimeAvg()});
	}
	
	this.updateCfdData = function(board, time) {
		if (time % (60 * 8) != 0) return;
		var day = (time/60/8);
		for (var i=0; i<board.columns.length - 1; i+=2) {
			var sum = board.columns[i].tasks.length + board.columns[i+1].tasks.length;
			this.cfdData[i/2].push({x: day, y:sum});
		}
		var lastDoneCount = this.cfdData[4][this.cfdData[4].length - 1] ? this.cfdData[4][this.cfdData[4].length - 1].y : 0;
		this.cfdData[4].push({x: day, y:(board.columns[board.columns.length - 1].tasks.length + lastDoneCount)});
	}
}

Array.prototype.average = function(){
	var total = 0;
	for (var i = 0; i < this.length; i++) {
		total += this[i];
	}
	return total / this.length;
}
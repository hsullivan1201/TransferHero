from flask import Flask
from flask import request
import requests
import numpy as np
import pandas as pd
import json

# information for connecting to wmata API
f = open('api_key.txt')
wmata_key = f.read()
headers = {'api_key': f'{wmata_key}'}


def trains_between(origin, dest, trains, routes):
    '''Returns Trains between origin and dest
    :param origin: string Station Code ie A07
    :param destination: string Station Code ie A01
    :param trains: trains json object from WMATA API
    :param routes: routes json object from WMATA API
    :return: int count of trains between origin and dest
    '''
    #red_line_trains ONLY
    red_line_track_1 = routes['StandardRoutes'][6]['TrackCircuits']
    red_line_track_2 = routes['StandardRoutes'][7]['TrackCircuits']
    
    circuits_between = set()
    for track in red_line_track_1, red_line_track_2:
        values_array = np.array([list(i.values()) for i in track]).T
        circuit_ids = values_array[1,:]
        station_codes = values_array[2,:]
        start = np.where(station_codes == origin)[0][0]
        end = np.where(station_codes == dest)[0][0]
        
        circuits_between.update(circuit_ids[min(start,end):max(start,end)])
    
    direction_num = 1 if start < end else 2
    
    trains = sum(1 for i in trains['TrainPositions'] if i['CircuitId'] in circuits_between and (i['DirectionNum'] == direction_num) and (i['ServiceType'] == 'Normal'))
    

    return trains

app = Flask(__name__)

@app.route("/")
def handle_request():
    # Test
    return "<p>Hello, World!</p>"

@app.route('/trains', methods=['GET'])
def login():
    # Getting Stations codes from incoming GET request
    origin = request.args.get('origin')
    origin = request.args.get('destination')
    
    # Get next incoming train *towards glenmont* (can change later)

    trains = requests.get(url = f"https://api.wmata.com/StationPrediction.svc/json/GetPrediction/{origin}",
                headers = headers).json()['Trains']
    origin_prediction_dataframe = pd.DataFrame(trains)
    
    origin_pickup_time = origin_prediction_dataframe.query('Destination == "Glenmont"').sort_values(by='Min').iloc[0]['Min']

    # Get that train's arrival time at metro center



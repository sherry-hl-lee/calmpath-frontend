# CalmPath Frontend

A web interface for sensory-aware pedestrian route planning in
Melbourne.

## Overview

CalmPath helps users explore walking routes using factors beyond
distance alone, including pedestrian crowd exposure and access to
lower-stimulation locations.

The frontend communicates with the CalmPath backend through REST APIs
and presents route alternatives, sensory indicators, public-transport
access information, and nearby refuge information through an interactive
browser experience.

## Key Features

-   Interactive walking-route planning
-   Sensory / crowd-condition indicators
-   Crowd-aware route comparison
-   Limited-data state when route information is incomplete
-   Nearby low-sensory refuge discovery
-   Tram and train access-point visualisation
-   Integration with the CalmPath REST backend
-   Browser-based responsive interface
-   Deployed web demo

## Tech Stack

-   JavaScript
-   HTML5
-   CSS3
-   REST / JSON APIs
-   GeoJSON / geospatial data
-   Netlify
-   Git & GitHub

## System Integration

``` text
User Browser
     |
     v
CalmPath Frontend
     |
     | REST / JSON
     v
CalmPath Backend
     |
     +----------> Routing
     +----------> Crowd Data
     +----------> Refuge Data
     +----------> Public Transport Data
```

## Backend

The frontend integrates with the separate CalmPath backend repository:

https://github.com/sherry-hl-lee/calmpath-backend

## Engineering Highlights

### Frontend--Backend Integration

The frontend consumes structured backend responses to present route,
crowd, refuge, and transport information without embedding backend
business logic directly into the interface.

### Communicating Data Confidence

The interface can distinguish between lower sensory exposure and
insufficient data, helping avoid presenting unknown conditions as safe
or low-crowd conditions.

### Geospatial Presentation

Route and location data are presented in a map-oriented interface,
allowing users to compare alternatives spatially and understand nearby
supporting locations.

## Project Context

Developed as part of the **CalmPath Monash University capstone
project**.

This was a collaborative team project. The system-level functionality is
documented above, while individual ownership should be recorded in **My
Contributions**.

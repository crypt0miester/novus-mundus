pub fn get_distance_between_to_locations(
    current_loc_lat_degrees: f64,
    current_loc_long_degrees: f64,
    destination_loc_lat_degrees: f64,
    destination_loc_long_degrees: f64,
) -> f64 {
    let earth_radius_kilometer = 6371.0_f64;
    // let (current_loc_lat_degrees, current_loc_long_degrees) = (48.85341_f64, -2.34880_f64);
    // let (destination_loc_lat_degrees, destination_loc_long_degrees) = (51.50853_f64, -0.12574_f64);

    let paris_latitude = current_loc_lat_degrees.to_radians();
    let london_latitude = destination_loc_lat_degrees.to_radians();

    let delta_latitude = (current_loc_lat_degrees - destination_loc_lat_degrees).to_radians();
    let delta_longitude = (current_loc_long_degrees - destination_loc_long_degrees).to_radians();

    let central_angle_inner = (delta_latitude / 2.0).sin().powi(2)
        + paris_latitude.cos() * london_latitude.cos() * (delta_longitude / 2.0).sin().powi(2);
    let central_angle = 2.0 * central_angle_inner.sqrt().asin();

    earth_radius_kilometer * central_angle
}

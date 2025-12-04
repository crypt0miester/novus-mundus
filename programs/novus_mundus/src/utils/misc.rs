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

    let sin_dlat_half = libm::sin(delta_latitude / 2.0);
    let sin_dlong_half = libm::sin(delta_longitude / 2.0);
    let central_angle_inner = sin_dlat_half * sin_dlat_half
        + libm::cos(paris_latitude) * libm::cos(london_latitude) * sin_dlong_half * sin_dlong_half;
    let central_angle = 2.0 * libm::asin(libm::sqrt(central_angle_inner));

    earth_radius_kilometer * central_angle
}
